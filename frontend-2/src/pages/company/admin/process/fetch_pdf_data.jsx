import {
  CloudDownloadOutlined,
  DownloadOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { Alert, Button, InputNumber, Layout, Space, Table, Typography, message } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography

const PDF_PROCESS_BASE = '/api/company/admin/process/pdf'
const CONFIGURE_PDF_BASE = '/api/company/admin/configure/pdf'

const PDF_DATA_DEFAULT_LIMIT = 50
const PDF_DATA_MAX_LIMIT = 500

function clampMailboxMaxMessages(value) {
  if (value == null || value === '') return undefined
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return undefined
  return Math.floor(n)
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

function clampPdfDataPage(page) {
  const n = Number(page)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.floor(n)
}

function clampPdfDataLimit(limit) {
  const n = Number(limit)
  if (!Number.isFinite(n) || n < 1) return PDF_DATA_DEFAULT_LIMIT
  return Math.min(PDF_DATA_MAX_LIMIT, Math.max(1, Math.floor(n)))
}

function normalizePdfDataRows(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.data)) return payload.data
    if (Array.isArray(payload.rows)) return payload.rows
    if (Array.isArray(payload.items)) return payload.items
  }
  return []
}

function getTableColumnsFromRows(rows) {
  const first = rows?.[0]
  if (!first || typeof first !== 'object') {
    return [
      {
        title: 'Value',
        dataIndex: 'value',
        key: 'value',
        ellipsis: true,
        render: (v) => (v === null || v === undefined ? '-' : String(v)),
      },
    ]
  }
  return Object.keys(first).map((k) => ({
    title: k,
    dataIndex: k,
    key: k,
    ellipsis: true,
    render: (value) => {
      if (value === null || value === undefined) return '-'
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value).slice(0, 200)
        } catch {
          return '[Object]'
        }
      }
      return String(value)
    },
  }))
}

export default function CompanyAdminFetchPdfDataPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [mailboxStatus, setMailboxStatus] = useState(null)
  const [mailboxStatusLoading, setMailboxStatusLoading] = useState(false)
  const [mailboxMaxMessages, setMailboxMaxMessages] = useState(null)

  const [pdfDataRows, setPdfDataRows] = useState([])
  const [pdfDataLoading, setPdfDataLoading] = useState(false)
  const [pdfDataPage, setPdfDataPage] = useState(1)
  const [pdfDataLimit, setPdfDataLimit] = useState(PDF_DATA_DEFAULT_LIMIT)
  const [pdfDataTotal, setPdfDataTotal] = useState(0)
  const [downloadingExcel, setDownloadingExcel] = useState(false)
  const [mailboxFetching, setMailboxFetching] = useState(false)
  const [lastMailboxResult, setLastMailboxResult] = useState(null)

  const checkMailboxStatus = useCallback(async () => {
    if (!BACKEND_URL) return
    setMailboxStatusLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}${CONFIGURE_PDF_BASE}/mailbox-status`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMailboxStatus(null)
        return
      }
      setMailboxStatus({
        provider: String(data.provider || '').trim().toLowerCase(),
        gmailReady: Boolean(data.gmail?.ready),
        outlookReady: Boolean(data.outlook?.ready),
      })
    } catch {
      setMailboxStatus(null)
    } finally {
      setMailboxStatusLoading(false)
    }
  }, [BACKEND_URL])

  const mailboxReady = Boolean(
    mailboxStatus?.provider &&
      ((mailboxStatus.provider === 'gmail' && mailboxStatus.gmailReady) ||
        (mailboxStatus.provider === 'outlook' && mailboxStatus.outlookReady)),
  )

  const activeProviderLabel =
    mailboxStatus?.provider === 'outlook'
      ? 'Outlook'
      : mailboxStatus?.provider === 'gmail'
        ? 'Gmail'
        : 'mailbox'

  const fetchPdfData = useCallback(
    async (page, limit) => {
      if (!BACKEND_URL) return
      const p = clampPdfDataPage(page)
      const l = clampPdfDataLimit(limit)
      setPdfDataLoading(true)
      try {
        const params = new URLSearchParams({
          page: String(p),
          limit: String(l),
        })
        const res = await fetch(`${BACKEND_URL}${PDF_PROCESS_BASE}/get-pdf-data?${params}`, {
          method: 'GET',
          credentials: 'include',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.detail || data?.message || `Failed to load PDF data (${res.status})`)
        }
        const rows = normalizePdfDataRows(data).filter((r) => r && typeof r === 'object')
        setPdfDataRows(rows)

        let total = 0
        if (data.pagination && typeof data.pagination === 'object') {
          const pg = data.pagination
          setPdfDataPage(clampPdfDataPage(pg.page ?? p))
          setPdfDataLimit(clampPdfDataLimit(pg.limit ?? l))
          total = Number(pg.total)
        } else {
          setPdfDataPage(p)
          setPdfDataLimit(l)
          const t = data.total ?? data.totalCount
          total = Number(t)
        }
        if (!Number.isFinite(total)) {
          total = rows.length
        }
        setPdfDataTotal(total)
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Failed to load PDF data')
        setPdfDataRows([])
        setPdfDataTotal(0)
      } finally {
        setPdfDataLoading(false)
      }
    },
    [BACKEND_URL],
  )

  const handleFetchFromMailbox = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!mailboxReady) {
      message.warning('Configure and activate Gmail or Outlook under Configure → PDF setup first.')
      return
    }

    const maxMessages = clampMailboxMaxMessages(mailboxMaxMessages)

    setMailboxFetching(true)
    setLastMailboxResult(null)
    try {
      const params = new URLSearchParams()
      if (maxMessages != null) {
        params.set('maxMessages', String(maxMessages))
      }
      const query = params.toString()
      const url = `${BACKEND_URL}${PDF_PROCESS_BASE}/get-pdf-data-from-mailbox${query ? `?${query}` : ''}`
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Mailbox fetch failed (${res.status})`)
      }

      setLastMailboxResult(data)

      if (data?.success === false) {
        message.warning(data?.message || 'Mailbox fetch completed with issues.')
      } else {
        message.success(data?.message || 'PDF data fetched from mailbox successfully.')
      }

      await fetchPdfData(1, pdfDataLimit)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to fetch PDF data from mailbox')
    } finally {
      setMailboxFetching(false)
    }
  }

  const handleDownloadPdfDataExcel = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }

    setDownloadingExcel(true)
    try {
      const res = await fetch(`${BACKEND_URL}${PDF_PROCESS_BASE}/get-pdf-data-in-to-excel`, {
        method: 'GET',
        credentials: 'include',
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.detail || err?.message || `Download failed (${res.status})`)
      }

      const blob = await res.blob()
      const headerName = fileNameFromContentDisposition(res.headers.get('Content-Disposition'))
      const fallbackName = `pdf-data-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`
      const filename = headerName || fallbackName

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      message.success('Excel file downloaded')
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to download Excel')
    } finally {
      setDownloadingExcel(false)
    }
  }

  useEffect(() => {
    if (!BACKEND_URL) return
    fetchPdfData(1, PDF_DATA_DEFAULT_LIMIT)
    checkMailboxStatus()
  }, [BACKEND_URL, fetchPdfData, checkMailboxStatus])

  const pdfDataColumns = useMemo(() => getTableColumnsFromRows(pdfDataRows), [pdfDataRows])

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
                  Fetch PDF data
                </Title>
                <Text type="secondary">
                  Fetch PDFs from the active mailbox provider (Gmail or Outlook), then view extracted data below.
                </Text>
              </div>
              <Space wrap align="center">
                <Space size={4} align="center">
                  <Text type="secondary">Mails to process:</Text>
                  <InputNumber
                    min={1}
                    max={500}
                    placeholder="All"
                    value={mailboxMaxMessages}
                    onChange={(value) => setMailboxMaxMessages(value ?? null)}
                    disabled={mailboxFetching || mailboxStatusLoading}
                    style={{ width: 88 }}
                  />
                </Space>
                <Button
                  size="small"
                  onClick={() => setMailboxMaxMessages(1)}
                  disabled={mailboxFetching || mailboxStatusLoading}
                >
                  1 only
                </Button>
                <Button
                  type="primary"
                  icon={<CloudDownloadOutlined />}
                  loading={mailboxFetching}
                  onClick={handleFetchFromMailbox}
                  disabled={!BACKEND_URL || mailboxFetching || !mailboxReady || mailboxStatusLoading}
                >
                  Fetch from mailbox
                </Button>
              </Space>
            </div>

            {!mailboxStatusLoading && !mailboxReady ? (
              <Alert
                type="warning"
                showIcon
                message="Mailbox not ready"
                description={
                  <span>
                    Set up Gmail or Outlook and activate a provider in{' '}
                    <Link to="/admin/configure/pdf">Configure → PDF setup</Link>.
                  </span>
                }
              />
            ) : null}

            {mailboxReady && mailboxStatus?.provider ? (
              <Alert
                type="info"
                showIcon
                message={`Active provider: ${activeProviderLabel}`}
                description={
                  mailboxMaxMessages
                    ? `Next fetch will process up to ${mailboxMaxMessages} mail(s) from the source folder/label.`
                    : 'Next fetch will process all mails in the source folder/label.'
                }
              />
            ) : null}

            {lastMailboxResult?.data ? (
              <div
                style={{
                  padding: '12px 16px',
                  background: lastMailboxResult.success === false ? '#fffbe6' : '#f6ffed',
                  border: `1px solid ${lastMailboxResult.success === false ? '#ffe58f' : '#b7eb8f'}`,
                  borderRadius: 8,
                }}
              >
                <Text strong style={{ display: 'block', marginBottom: 4 }}>
                  Last mailbox fetch
                </Text>
                {lastMailboxResult.message ? (
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                    {String(lastMailboxResult.message)}
                  </Text>
                ) : null}
                <Space wrap size={[8, 8]}>
                  {lastMailboxResult.provider ? (
                    <Text>
                      Provider: <Text code>{String(lastMailboxResult.provider)}</Text>
                    </Text>
                  ) : null}
                  <Text>
                    From:{' '}
                    <Text code>
                      {String(
                        lastMailboxResult.data.fromMailboxName ||
                          lastMailboxResult.data.fromLabelName ||
                          '—',
                      )}
                    </Text>
                  </Text>
                  <Text>
                    Total in batch: <Text code>{String(lastMailboxResult.data.total_mails ?? 0)}</Text>
                  </Text>
                  <Text>
                    Processed: <Text code>{String(lastMailboxResult.data.processed_mails ?? 0)}</Text>
                  </Text>
                  <Text>
                    Skipped: <Text code>{String(lastMailboxResult.data.skipped_mails ?? 0)}</Text>
                  </Text>
                  <Text>
                    Failed: <Text code>{String(lastMailboxResult.data.failed_mails ?? 0)}</Text>
                  </Text>
                  <Text>
                    Stored rows: <Text code>{String(lastMailboxResult.data.stored_rows ?? 0)}</Text>
                  </Text>
                </Space>
              </div>
            ) : null}

            <div style={{ minWidth: 0, width: '100%' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                  marginBottom: 12,
                  position: 'sticky',
                  top: 0,
                  zIndex: 10,
                  background: '#fff',
                  paddingTop: 8,
                  paddingBottom: 8,
                  marginInline: -24,
                  paddingInline: 24,
                  borderBottom: '1px solid #f0f0f0',
                  boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
                }}
              >
                <Title level={5} style={{ margin: 0 }}>
                  PDF data
                </Title>
                <Space wrap>
                  <Button
                    icon={<DownloadOutlined />}
                    loading={downloadingExcel}
                    onClick={handleDownloadPdfDataExcel}
                    disabled={!BACKEND_URL || downloadingExcel || mailboxFetching}
                  >
                    Download PDF data (Excel)
                  </Button>
                  <Button
                    icon={<ReloadOutlined />}
                    loading={pdfDataLoading}
                    onClick={() => fetchPdfData(pdfDataPage, pdfDataLimit)}
                    disabled={!BACKEND_URL || pdfDataLoading || mailboxFetching}
                  >
                    Refresh
                  </Button>
                </Space>
              </div>
              <div
                style={{
                  minWidth: 0,
                  width: '100%',
                  maxWidth: '100%',
                  overflowX: 'auto',
                  WebkitOverflowScrolling: 'touch',
                  boxSizing: 'border-box',
                }}
              >
                <Table
                  rowKey={(_, index) => `pdf-data-${pdfDataPage}-${index}`}
                  columns={pdfDataColumns}
                  dataSource={pdfDataRows}
                  loading={pdfDataLoading}
                  sticky
                  pagination={{
                    current: pdfDataPage,
                    pageSize: pdfDataLimit,
                    total: pdfDataTotal,
                    showSizeChanger: true,
                    pageSizeOptions: ['10', '20', '50', '100', '200', '500'],
                    showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}`,
                    onChange: (page, pageSize) => fetchPdfData(page, pageSize),
                    onShowSizeChange: (_, size) => fetchPdfData(1, size),
                  }}
                  scroll={{ x: 'max-content', y: 520 }}
                  size="small"
                />
              </div>
            </div>
          </Space>
        </AppShell>
  )
}
