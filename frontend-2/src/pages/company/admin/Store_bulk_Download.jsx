import {
  CloudDownloadOutlined,
  DownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { Button, Card, DatePicker, Form, Space, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../components/company/sidebar.jsx'
import AppShell from '../../../components/layout/AppShell.jsx'
import { splitEbrcDateRange } from '../../../utils/ebrcDateRangeSplit.js'

const { Title, Text } = Typography

const EBRC_API = '/api/company/admin/ebrc/eBRC-Bulk-Download-request'
const EBRC_SUBMIT_API = '/api/company/admin/ebrc/submit-bulk-download-request'
const STORE_ATTACHMENT_API = '/api/company/admin/ebrc/store-attachment'
const STORED_LIST_API = '/api/company/admin/ebrc/stored-attachments'
const STORED_EXCEL_API = '/api/company/admin/ebrc/stored-attachments'
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

function formatStoredAt(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()
}

export default function CompanyAdminStoreBulkDownloadPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [dgftRows, setDgftRows] = useState([])
  const [dgftCount, setDgftCount] = useState(0)
  const [dgftLoading, setDgftLoading] = useState(false)

  const [storedRows, setStoredRows] = useState([])
  const [storedTotal, setStoredTotal] = useState(0)
  const [storedPage, setStoredPage] = useState(1)
  const [storedPageSize, setStoredPageSize] = useState(20)
  const [storedLoading, setStoredLoading] = useState(false)

  const [storingAttachId, setStoringAttachId] = useState(null)
  const [exportingStoredId, setExportingStoredId] = useState(null)
  const [submittingRequest, setSubmittingRequest] = useState(false)
  const [splitChunks, setSplitChunks] = useState([])
  const [submitForm] = Form.useForm()

  const fetchDgftRequests = useCallback(async () => {
    if (!BACKEND_URL) return
    setDgftLoading(true)
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
      setDgftRows(list)
      setDgftCount(Number(data?.count) || list.length)
      if (data?.success === false) {
        message.warning(data?.message || 'Request completed with issues')
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load DGFT bulk requests')
      setDgftRows([])
      setDgftCount(0)
    } finally {
      setDgftLoading(false)
    }
  }, [BACKEND_URL])

  const fetchStoredAttachments = useCallback(async () => {
    if (!BACKEND_URL) return
    setStoredLoading(true)
    try {
      const qs = new URLSearchParams({
        page: String(storedPage),
        limit: String(storedPageSize),
      })
      const res = await fetch(`${BACKEND_URL}${STORED_LIST_API}?${qs}`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load stored attachments (${res.status})`)
      }
      setStoredRows(Array.isArray(data.rows) ? data.rows : [])
      setStoredTotal(typeof data.total === 'number' ? data.total : 0)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load stored attachments')
      setStoredRows([])
      setStoredTotal(0)
    } finally {
      setStoredLoading(false)
    }
  }, [BACKEND_URL, storedPage, storedPageSize])

  useEffect(() => {
    fetchDgftRequests()
  }, [fetchDgftRequests])

  useEffect(() => {
    fetchStoredAttachments()
  }, [fetchStoredAttachments])

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
      await fetchDgftRequests()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to submit bulk download request')
    } finally {
      setSubmittingRequest(false)
    }
  }

  const handleStoreAttachment = useCallback(
    async (record) => {
      const attachId = String(record?.attachId ?? '').trim()
      const fromDate = String(record?.fromDate ?? '').trim()
      const toDate = String(record?.toDate ?? '').trim()

      if (!BACKEND_URL) {
        message.error('Backend URL is not configured (VITE_BACKEND_URL).')
        return
      }
      if (!attachId) {
        message.warning('No attachment ID for this row.')
        return
      }

      setStoringAttachId(attachId)
      try {
        const res = await fetch(`${BACKEND_URL}${STORE_ATTACHMENT_API}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attachId, fromDate, toDate }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.detail || data?.message || `Store failed (${res.status})`)
        }
        message.success(data?.message || `Stored attachment ${attachId}`)
        setStoredPage(1)
        await fetchStoredAttachments()
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Failed to store attachment')
      } finally {
        setStoringAttachId(null)
      }
    },
    [BACKEND_URL, fetchStoredAttachments],
  )

  const handleExportStoredExcel = useCallback(
    async (storedId, attachId) => {
      const id = String(storedId ?? '').trim()
      if (!BACKEND_URL) {
        message.error('Backend URL is not configured (VITE_BACKEND_URL).')
        return
      }
      if (!id) {
        message.warning('Missing stored record id.')
        return
      }

      setExportingStoredId(id)
      try {
        const res = await fetch(`${BACKEND_URL}${STORED_EXCEL_API}/${encodeURIComponent(id)}/excel`, {
          method: 'GET',
          credentials: 'include',
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err?.detail || err?.message || `Export failed (${res.status})`)
        }

        const blob = await res.blob()
        const headerName = fileNameFromContentDisposition(res.headers.get('Content-Disposition'))
        const filename = headerName || `ebrc-stored-${attachId || id}.xlsx`

        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        message.success(`Excel download started: ${filename}`)
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Failed to export stored attachment')
      } finally {
        setExportingStoredId(null)
      }
    },
    [BACKEND_URL],
  )

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchDgftRequests(), fetchStoredAttachments()])
  }, [fetchDgftRequests, fetchStoredAttachments])

  const dgftColumns = useMemo(
    () => [
      { title: 'Sr No', dataIndex: 'srNo', key: 'srNo', width: 72, render: cellText },
      { title: 'Request Type', dataIndex: 'requestType', key: 'requestType', width: 120, render: cellText },
      { title: 'From Date', dataIndex: 'fromDate', key: 'fromDate', width: 120, render: cellText },
      { title: 'To Date', dataIndex: 'toDate', key: 'toDate', width: 120, render: cellText },
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
      { title: 'Submitted By', dataIndex: 'submittedBy', key: 'submittedBy', ellipsis: true, render: cellText },
      {
        title: 'Store',
        key: 'store',
        width: 110,
        fixed: 'right',
        render: (_, record) => {
          const attachId = String(record?.attachId ?? '').trim()
          const isStoring = storingAttachId === attachId
          return (
            <Button
              type="link"
              size="small"
              icon={<SaveOutlined />}
              loading={isStoring}
              disabled={!attachId || !BACKEND_URL || (storingAttachId != null && !isStoring)}
              onClick={() => handleStoreAttachment(record)}
            >
              Store
            </Button>
          )
        },
      },
    ],
    [BACKEND_URL, storingAttachId, handleStoreAttachment],
  )

  const storedColumns = useMemo(
    () => [
      {
        title: 'Stored ID',
        dataIndex: 'id',
        key: 'id',
        width: 220,
        ellipsis: true,
        render: (v) => <Text code>{cellText(v)}</Text>,
      },
      {
        title: 'Attach ID',
        dataIndex: 'attachId',
        key: 'attachId',
        width: 130,
        render: (v) => <Text code>{cellText(v)}</Text>,
      },
      { title: 'From Date', dataIndex: 'fromDate', key: 'fromDate', width: 120, render: cellText },
      { title: 'To Date', dataIndex: 'toDate', key: 'toDate', width: 120, render: cellText },
      { title: 'File', dataIndex: 'fileName', key: 'fileName', width: 180, ellipsis: true, render: cellText },
      {
        title: 'Rows',
        dataIndex: 'rowCount',
        key: 'rowCount',
        width: 80,
        align: 'right',
        render: (v) => (v == null ? '—' : String(v)),
      },
      {
        title: 'Stored At',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 170,
        render: formatStoredAt,
      },
      {
        title: 'Excel',
        key: 'excel',
        width: 110,
        fixed: 'right',
        render: (_, record) => {
          const id = String(record?.id ?? '').trim()
          const isExporting = exportingStoredId === id
          return (
            <Button
              type="link"
              size="small"
              icon={<DownloadOutlined />}
              loading={isExporting}
              disabled={!id || !BACKEND_URL || (exportingStoredId != null && !isExporting)}
              onClick={() => handleExportStoredExcel(id, record?.attachId)}
            >
              Excel
            </Button>
          )
        },
      },
    ],
    [BACKEND_URL, exportingStoredId, handleExportStoredExcel],
  )

  const splitPreviewColumns = useMemo(
    () => [
      { title: '#', key: 'index', width: 56, render: (_, __, index) => index + 1 },
      { title: 'From Date', dataIndex: 'fromDate', key: 'fromDate', width: 140, render: cellText },
      { title: 'To Date', dataIndex: 'toDate', key: 'toDate', width: 140, render: cellText },
      { title: 'Days', dataIndex: 'days', key: 'days', width: 80, render: cellText },
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
              Store Bulk Download
            </Title>
            <Text type="secondary">
              Submit eBRC bulk requests on DGFT, store attachments locally, and export stored Excel
              later.
            </Text>
          </div>
          <Button
            icon={<ReloadOutlined />}
            loading={dgftLoading || storedLoading}
            onClick={refreshAll}
            disabled={!BACKEND_URL || dgftLoading || storedLoading || submittingRequest}
          >
            Refresh
          </Button>
        </div>

        <Card size="small" title="Submit bulk download request">
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            Select a date range ({DATE_FORMAT}). The system auto-splits each month into 1–15 and
            16–end and submits one request per chunk to DGFT.
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
              />
            </div>
          ) : null}
        </Card>

        <Card
          size="small"
          title={
            <Space>
              <CloudDownloadOutlined />
              <span>DGFT bulk requests</span>
            </Space>
          }
          styles={{ body: { padding: 0 } }}
        >
          <Table
            rowKey={(row, index) => `${row?.attachId ?? row?.srNo ?? 'row'}-${row?.requestDateTime ?? index}`}
            size="small"
            loading={dgftLoading}
            columns={dgftColumns}
            dataSource={dgftRows}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              showTotal: (total) => `${total} request(s)`,
            }}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: 'No DGFT bulk download requests found' }}
          />
          {!dgftLoading && dgftRows.length > 0 ? (
            <div style={{ padding: '8px 16px' }}>
              <Text type="secondary">Total: {dgftCount || dgftRows.length}</Text>
            </div>
          ) : null}
        </Card>

        <Card
          size="small"
          title={
            <Space>
              <SaveOutlined />
              <span>Stored attachments</span>
            </Space>
          }
          styles={{ body: { padding: 0 } }}
        >
          <Table
            rowKey="id"
            size="small"
            loading={storedLoading}
            columns={storedColumns}
            dataSource={storedRows}
            pagination={{
              current: storedPage,
              pageSize: storedPageSize,
              total: storedTotal,
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50', '100'],
              showTotal: (total) => `${total} stored attachment(s)`,
              onChange: (page, size) => {
                setStoredPage(page)
                setStoredPageSize(size)
              },
            }}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: 'No stored attachments yet — use Store on a DGFT request row' }}
          />
        </Card>
      </Space>
    </AppShell>
  )
}
