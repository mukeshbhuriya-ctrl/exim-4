import {
  CloudDownloadOutlined,
  DownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  CloseOutlined,
} from '@ant-design/icons'
import {
  Button,
  DatePicker,
  Form,
  Space,
  Table,
  Tag,
  Typography,
  message,
  Tabs,
  Tooltip
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useMemo, useState } from 'react'
import CompanySidebar from '../../../components/company/sidebar.jsx'
import AppShell from '../../../components/layout/AppShell.jsx'
import ProDataTable from '../../../components/shared/ProDataTable.jsx'
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

  const [refreshDgftKey, setRefreshDgftKey] = useState(0)
  const [refreshStoredKey, setRefreshStoredKey] = useState(0)

  const [storingAttachId, setStoringAttachId] = useState(null)
  const [exportingStoredId, setExportingStoredId] = useState(null)
  const [submittingRequest, setSubmittingRequest] = useState(false)
  const [splitChunks, setSplitChunks] = useState([])
  const [showRequestForm, setShowRequestForm] = useState(false)
  const [submitForm] = Form.useForm()

  const fetchDgftRequests = useCallback(async (page = 1, pageSize = 20) => {
    if (!BACKEND_URL) return { data: [], meta: { total: 0 } }
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
      if (data?.success === false) {
        message.warning(data?.message || 'Request completed with issues')
      }
      const start = (page - 1) * pageSize
      return { data: list.slice(start, start + pageSize), meta: { total: list.length } }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load DGFT bulk requests')
      return { data: [], meta: { total: 0 } }
    }
  }, [BACKEND_URL])

  const fetchStoredAttachments = useCallback(async (page = 1, limit = 20) => {
    if (!BACKEND_URL) return { data: [], meta: { total: 0 } }
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      })
      const res = await fetch(`${BACKEND_URL}${STORED_LIST_API}?${qs}`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load stored attachments (${res.status})`)
      }
      return {
        data: Array.isArray(data.rows) ? data.rows : [],
        meta: { total: typeof data.total === 'number' ? data.total : 0 }
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load stored attachments')
      return { data: [], meta: { total: 0 } }
    }
  }, [BACKEND_URL])

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
      setRefreshDgftKey(prev => prev + 1)
      submitForm.resetFields()
      setSplitChunks([])
      setShowRequestForm(false)
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
        setRefreshStoredKey(prev => prev + 1)
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

  const refreshAll = useCallback(() => {
    setRefreshDgftKey(prev => prev + 1)
    setRefreshStoredKey(prev => prev + 1)
  }, [])

  const dgftColumns = useMemo(
    () => [
      { title: 'Sr No', dataIndex: 'srNo', key: 'srNo', width: 72, render: cellText },
      { title: 'Request Type', dataIndex: 'requestType', key: 'requestType', render: cellText },
      { title: 'From Date', dataIndex: 'fromDate', key: 'fromDate', render: cellText },
      { title: 'To Date', dataIndex: 'toDate', key: 'toDate', render: cellText },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
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
        render: (value) => <Text code>{cellText(value)}</Text>,
      },
      {
        title: 'Request Date Time',
        dataIndex: 'requestDateTime',
        key: 'requestDateTime',
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
        ellipsis: true,
        render: (v) => <Text code>{cellText(v)}</Text>,
      },
      {
        title: 'Attach ID',
        dataIndex: 'attachId',
        key: 'attachId',
        render: (v) => <Text code>{cellText(v)}</Text>,
      },
      { title: 'From Date', dataIndex: 'fromDate', key: 'fromDate', render: cellText },
      { title: 'To Date', dataIndex: 'toDate', key: 'toDate', render: cellText },
      { title: 'File', dataIndex: 'fileName', key: 'fileName', ellipsis: true, render: cellText },
      {
        title: 'Rows',
        dataIndex: 'rowCount',
        key: 'rowCount',
        align: 'right',
        render: (v) => (v == null ? '—' : String(v)),
      },
      {
        title: 'Stored At',
        dataIndex: 'createdAt',
        key: 'createdAt',
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
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            background: '#f8f9fa',
            border: '1px solid var(--exim-border-light)',
            borderRadius: 8,
            flexWrap: 'wrap',
            gap: 16
          }}
        >
          <div>
            <Title level={5} style={{ margin: 0 }}>Store Bulk Download</Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Manage eBRC bulk requests on DGFT and stored attachments.
            </Text>
          </div>
          <Button
            icon={<ReloadOutlined />}
            onClick={refreshAll}
            disabled={!BACKEND_URL || submittingRequest}
          >
            Refresh All
          </Button>
        </div>



        <div style={{ width: '100%', minWidth: 0 }}>
          <Tabs
            items={[
              {
                label: 'DGFT Bulk Requests',
                key: 'requests',
                children: (
                  <ProDataTable
                    columns={dgftColumns}
                    fetchData={fetchDgftRequests}
                    refreshKey={refreshDgftKey}
                    rowKey={(row, index) => `${row?.attachId ?? row?.srNo ?? 'row'}-${row?.requestDateTime ?? index}`}
                    showSelectionColumn={false}
                    globalSearchPlaceholder="Search requests..."
                    customToolbarActions={
                      <Space size={12} align="center">
                        {!showRequestForm ? (
                          <Tooltip title="Bulk Download request">
                            <Button
                              type="primary"
                              icon={<PlusOutlined />}
                              onClick={() => setShowRequestForm(true)}
                            >
                              Bulk Download
                            </Button>
                          </Tooltip>
                        ) : (
                          <Form
                            form={submitForm}
                            layout="inline"
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
                              style={{ margin: 0, marginRight: 8, width: 260 }}
                              rules={[{ required: true, message: 'Date range required' }]}
                            >
                              <DatePicker.RangePicker format={DATE_FORMAT} allowClear={false} placeholder={['Start Date', 'End Date']} />
                            </Form.Item>
                            <Form.Item style={{ margin: 0 }}>
                              <Button
                                type="primary"
                                icon={<PlusOutlined />}
                                loading={submittingRequest}
                                disabled={!BACKEND_URL || !splitChunks.length}
                                onClick={handleSubmitBulkRequest}
                              >
                                Submit {splitChunks.length ? `(${splitChunks.length})` : ''}
                              </Button>
                            </Form.Item>
                            <Form.Item style={{ margin: 0, marginLeft: 4 }}>
                              <Button
                                type="text"
                                icon={<CloseOutlined />}
                                onClick={() => {
                                  setShowRequestForm(false)
                                  submitForm.resetFields()
                                  setSplitChunks([])
                                }}
                              />
                            </Form.Item>
                          </Form>
                        )}
                        <Button
                          icon={<ReloadOutlined />}
                          onClick={() => setRefreshDgftKey(prev => prev + 1)}
                        >
                          Reload
                        </Button>
                      </Space>
                    }
                  />
                )
              },
              {
                label: 'Stored Attachments',
                key: 'stored',
                children: (
                  <ProDataTable
                    columns={storedColumns}
                    fetchData={fetchStoredAttachments}
                    refreshKey={refreshStoredKey}
                    rowKey="id"
                    showSelectionColumn={false}
                    globalSearchPlaceholder="Search stored..."
                    customToolbarActions={
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={() => setRefreshStoredKey(prev => prev + 1)}
                      >
                        Reload
                      </Button>
                    }
                  />
                )
              }
            ]}
          />
        </div>
      </Space>
    </AppShell>
  )
}
