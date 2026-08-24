import { DownloadOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Card, DatePicker, Form, Layout, Space, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../components/company/sidebar.jsx'
import AppShell from '../../../components/layout/AppShell.jsx'
import PageHeader from '../../../components/common/PageHeader.jsx'
import { splitEbrcDateRange } from '../../../utils/ebrcDateRangeSplit.js'

const { Content } = Layout
const { Title, Text } = Typography

const EBRC_API = '/api/company/admin/ebrc/eBRC-Bulk-Download-request'
const EBRC_DOWNLOAD_API = '/api/company/admin/ebrc/download-attachment'
const EBRC_SUBMIT_API = '/api/company/admin/ebrc/submit-bulk-download-request'
const DATE_FORMAT = 'DD/MM/YYYY'

function formatDateForApi(value) {
  if (!value || !dayjs.isDayjs(value) || !value.isValid()) return ''
  return value.format(DATE_FORMAT)
}

function isValidRange(from, to) {
  if (!from?.isValid() || !to?.isValid()) return false
  return !to.isBefore(from, 'day')
}

function fileNameFromContentDisposition(header) {
  if (!header || typeof header !== 'string') return null
  const star = /filename\*=UTF-8''([^;\n]+)/i.exec(header)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      return star[1].trim()
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(header)
  if (quoted?.[1]) return quoted[1].trim()
  const plain = /filename=([^;\n]+)/i.exec(header)
  if (plain?.[1]) return plain[1].trim().replace(/^"(.*)"$/, '$1')
  return null
}

function normalizeEbrcRows(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object' && Array.isArray(payload.data)) return payload.data
  return []
}

function statusTagColor(status) {
  const s = String(status || '').toLowerCase()
  if (s.includes('process')) return 'green'
  if (s.includes('pending') || s.includes('progress')) return 'blue'
  if (s.includes('fail') || s.includes('error') || s.includes('reject')) return 'red'
  return 'default'
}

function cellText(value) {
  if (value == null || value === '') return '—'
  return String(value)
}

export default function CompanyAdminEbrcBulkDownloadPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [downloadingAttachId, setDownloadingAttachId] = useState(null)
  const [submittingRequest, setSubmittingRequest] = useState(false)
  const [splitChunks, setSplitChunks] = useState([])
  const [submitForm] = Form.useForm()

  const fetchRequests = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}${EBRC_API}`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load eBRC requests (${res.status})`)
      }
      const list = normalizeEbrcRows(data).filter((r) => r && typeof r === 'object')
      setRows(list)
      setCount(Number(data?.count) || list.length)
      if (data?.success === false) {
        message.warning(data?.message || 'Request completed with issues')
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load eBRC bulk download requests')
      setRows([])
      setCount(0)
    } finally {
      setLoading(false)
    }
  }, [BACKEND_URL])

  useEffect(() => {
    fetchRequests()
  }, [fetchRequests])

  const loadSplitPreview = useCallback((from, to) => {
    if (!isValidRange(from, to)) {
      setSplitChunks([])
      return
    }

    const irmFromDate = formatDateForApi(from)
    const irmToDate = formatDateForApi(to)
    const split = splitEbrcDateRange(irmFromDate, irmToDate)

    if (split.error) {
      setSplitChunks([])
      message.error(split.error)
      return
    }

    setSplitChunks(split.chunks)
  }, [])

  const handleSubmitBulkRequest = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }

    let values
    try {
      values = await submitForm.validateFields()
    } catch {
      return
    }

    const from = values.dateRange?.[0]
    const to = values.dateRange?.[1]
    if (!isValidRange(from, to)) {
      message.error('Select a valid from and to date.')
      return
    }
    if (!splitChunks.length) {
      message.error('No split date ranges to submit. Check the preview.')
      return
    }

    const irmFromDate = formatDateForApi(from)
    const irmToDate = formatDateForApi(to)

    setSubmittingRequest(true)
    try {
      const res = await fetch(`${BACKEND_URL}${EBRC_SUBMIT_API}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ irmFromDate, irmToDate }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Submit failed (${res.status})`)
      }
      if (data?.failedCount > 0) {
        message.warning(
          data?.message ||
            `Submitted ${data?.submittedCount ?? 0} of ${data?.chunkCount ?? splitChunks.length} range(s).`,
        )
      } else {
        message.success(
          data?.message ||
            `Bulk download request submitted for ${data?.submittedCount ?? splitChunks.length} range(s).`,
        )
      }
      await fetchRequests()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to submit bulk download request')
    } finally {
      setSubmittingRequest(false)
    }
  }

  const handleDownloadAttachment = useCallback(
    async (attachId) => {
      const id = String(attachId ?? '').trim()
      if (!BACKEND_URL) {
        message.error('Backend URL is not configured (VITE_BACKEND_URL).')
        return
      }
      if (!id) {
        message.warning('No attachment ID for this row.')
        return
      }

      setDownloadingAttachId(id)
      try {
        const res = await fetch(`${BACKEND_URL}${EBRC_DOWNLOAD_API}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attachId: id }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err?.detail || err?.message || `Download failed (${res.status})`)
        }

        const blob = await res.blob()
        const headerName = fileNameFromContentDisposition(res.headers.get('Content-Disposition'))
        const fallbackName = `ebrc-attachment-${id}.zip`
        const filename = headerName || fallbackName

        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        message.success(`Download started: ${filename}`)
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Failed to download attachment')
      } finally {
        setDownloadingAttachId(null)
      }
    },
    [BACKEND_URL],
  )

  const columns = useMemo(
    () => [
      {
        title: 'Sr No',
        dataIndex: 'srNo',
        key: 'srNo',
        width: 72,
        render: cellText,
      },
      {
        title: 'Request Type',
        dataIndex: 'requestType',
        key: 'requestType',
        width: 120,
        render: cellText,
      },
      {
        title: 'From Date',
        dataIndex: 'fromDate',
        key: 'fromDate',
        width: 120,
        render: cellText,
      },
      {
        title: 'To Date',
        dataIndex: 'toDate',
        key: 'toDate',
        width: 120,
        render: cellText,
      },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        width: 120,
        render: (value) => {
          const text = cellText(value)
          if (text === '—') return text
          return <Tag color={statusTagColor(value)}>{text}</Tag>
        },
      },
      {
        title: 'Attach ID',
        dataIndex: 'attachId',
        key: 'attachId',
        width: 130,
        render: (value) => <Text code>{cellText(value)}</Text>,
      },
      {
        title: 'Request Date Time',
        dataIndex: 'requestDateTime',
        key: 'requestDateTime',
        width: 180,
        ellipsis: true,
        render: cellText,
      },
      {
        title: 'Submitted By',
        dataIndex: 'submittedBy',
        key: 'submittedBy',
        ellipsis: true,
        render: cellText,
      },
      {
        title: 'Download',
        key: 'download',
        width: 120,
        fixed: 'right',
        render: (_, record) => {
          const attachId = String(record?.attachId ?? '').trim()
          const isDownloading = downloadingAttachId === attachId
          return (
            <Button
              type="link"
              size="small"
              icon={<DownloadOutlined />}
              loading={isDownloading}
              disabled={!attachId || !BACKEND_URL || (downloadingAttachId != null && !isDownloading)}
              onClick={() => handleDownloadAttachment(attachId)}
            >
              Download
            </Button>
          )
        },
      },
    ],
    [BACKEND_URL, downloadingAttachId, handleDownloadAttachment],
  )

  const splitPreviewColumns = useMemo(
    () => [
      {
        title: '#',
        key: 'index',
        width: 56,
        render: (_, __, index) => index + 1,
      },
      {
        title: 'From Date',
        dataIndex: 'fromDate',
        key: 'fromDate',
        width: 140,
        render: cellText,
      },
      {
        title: 'To Date',
        dataIndex: 'toDate',
        key: 'toDate',
        width: 140,
        render: cellText,
      },
      {
        title: 'Days',
        dataIndex: 'days',
        key: 'days',
        width: 80,
        render: cellText,
      },
    ],
    [],
  )

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="middle" style={{ width: '100%', minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <Title level={3} style={{ margin: 0 }}>
                  eBRC Bulk Download
                </Title>
              </div>
              <Button
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={fetchRequests}
                disabled={!BACKEND_URL || loading || submittingRequest}
              >
                Refresh
              </Button>
            </div>

            <Card size="small" title="Submit bulk download request">
              <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                Select a large date range ({DATE_FORMAT}). The system auto-splits each month into
                1–15 and 16–end (30-day months: 16–30, 31-day months: 16–31) and submits one
                request per chunk.
              </Text>
              <Form
                form={submitForm}
                layout="vertical"
                disabled={submittingRequest}
                onValuesChange={(changed, all) => {
                  const range = all.dateRange
                  if (!changed.dateRange || !Array.isArray(range)) return
                  const [from, to] = range
                  if (from?.isValid() && to?.isValid()) {
                    loadSplitPreview(from, to)
                  } else {
                    setSplitChunks([])
                  }
                }}
              >
                <Form.Item
                  name="dateRange"
                  label="Date range"
                  rules={[{ required: true, message: 'Date range is required' }]}
                >
                  <DatePicker.RangePicker format={DATE_FORMAT} allowClear={false} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    loading={submittingRequest}
                    disabled={!BACKEND_URL || !splitChunks.length}
                    onClick={handleSubmitBulkRequest}
                  >
                    Submit {splitChunks.length ? `${splitChunks.length} request(s)` : 'request'}
                  </Button>
                </Form.Item>
              </Form>

              {splitChunks.length ? (
                <div style={{ marginTop: 16 }}>
                  <Text strong style={{ display: 'block', marginBottom: 8 }}>
                    Split preview
                  </Text>
                  <Table
                    rowKey={(row, index) => `${row.fromDate}-${row.toDate}-${index}`}
                    size="small"
                    columns={splitPreviewColumns}
                    dataSource={splitChunks}
                    pagination={false}
                    locale={{ emptyText: 'Select a date range to preview splits' }}
                  />
                </div>
              ) : null}
            </Card>

            <div style={{ minWidth: 0, width: '100%', overflowX: 'auto' }}>
              <Table
                rowKey={(row, index) =>
                  `${row?.attachId ?? row?.srNo ?? 'row'}-${row?.requestDateTime ?? index}`
                }
                size="small"
                loading={loading}
                columns={columns}
                dataSource={rows}
                pagination={{
                  pageSize: 20,
                  showSizeChanger: true,
                  showTotal: (total) => `${total} request(s)`,
                }}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: 'No eBRC bulk download requests found' }}
              />
            </div>

            {!loading && rows.length > 0 ? (
              <Text type="secondary">Total: {count || rows.length}</Text>
            ) : null}
          </Space>
        </AppShell>
  )
}
