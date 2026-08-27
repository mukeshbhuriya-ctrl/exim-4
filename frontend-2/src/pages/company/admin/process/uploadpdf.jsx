import { CloudUploadOutlined, CloseOutlined, DownloadOutlined, ReloadOutlined, CloudDownloadOutlined } from '@ant-design/icons'
import { Button, Layout, Space, Table, Typography, Upload, message, Card, InputNumber, Alert, Tooltip, Tag } from 'antd'
import { Link } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'
import ProDataTable from '../../../../components/shared/ProDataTable.jsx'

const { Content } = Layout
const { Title, Text } = Typography

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

const PDF_DATA_DEFAULT_LIMIT = 50
const PDF_DATA_MAX_LIMIT = 500

function clampMailboxMaxMessages(value) {
  if (value == null || value === '') return undefined
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return undefined
  return Math.floor(n)
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

export default function CompanyAdminUploadPdfPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [downloadingExcel, setDownloadingExcel] = useState(false)
  const [currentView, setCurrentView] = useState('list') // 'list' | 'upload'
  const [pdfDataLoading, setPdfDataLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [dynamicColumns, setDynamicColumns] = useState([])

  const [mailboxStatus, setMailboxStatus] = useState(null)
  const [mailboxStatusLoading, setMailboxStatusLoading] = useState(false)
  const [mailboxMaxMessages, setMailboxMaxMessages] = useState(null)
  const [mailboxFetching, setMailboxFetching] = useState(false)
  const [lastMailboxResult, setLastMailboxResult] = useState(null)

  const checkMailboxStatus = useCallback(async () => {
    if (!BACKEND_URL) return
    setMailboxStatusLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/configure/pdf/mailbox-status`, {
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

  useEffect(() => {
    checkMailboxStatus()
  }, [checkMailboxStatus])

  const mailboxReady = Boolean(
    mailboxStatus?.provider &&
      ((mailboxStatus.provider === 'gmail' && mailboxStatus.gmailReady) ||
        (mailboxStatus.provider === 'outlook' && mailboxStatus.outlookReady)),
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
      const url = `${BACKEND_URL}/api/company/admin/process/pdf/get-pdf-data-from-mailbox${query ? `?${query}` : ''}`
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

      setRefreshKey(prev => prev + 1)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to fetch PDF data from mailbox')
    } finally {
      setMailboxFetching(false)
    }
  }

  const fetchData = useCallback(
    async ({ page, limit }) => {
      if (!BACKEND_URL) return { data: [], meta: { total: 0 } }
      const p = clampPdfDataPage(page)
      const l = clampPdfDataLimit(limit)

      try {
        const params = new URLSearchParams({
          page: String(p),
          limit: String(l),
        })
        const res = await fetch(`${BACKEND_URL}/api/company/admin/process/pdf/get-pdf-data?${params}`, {
          method: 'GET',
          credentials: 'include',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.detail || data?.message || `Failed to load PDF data (${res.status})`)
        }
        const rows = normalizePdfDataRows(data).filter((r) => r && typeof r === 'object')

        // Update columns dynamically
        setDynamicColumns(getTableColumnsFromRows(rows))

        let total = 0
        if (data.pagination && typeof data.pagination === 'object') {
          total = Number(data.pagination.total)
        } else {
          total = Number(data.total ?? data.totalCount)
        }
        if (!Number.isFinite(total)) total = rows.length

        return {
          data: rows,
          meta: {
            total,
            page: p,
            totalPages: Math.ceil(total / l)
          }
        }
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Failed to load PDF data')
        return { data: [], meta: { total: 0 } }
      }
    },
    [BACKEND_URL],
  )

  const handleBeforeUpload = (file) => {
    const lowerName = String(file.name || '').toLowerCase()
    const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf')
    const isEml =
      lowerName.endsWith('.eml') ||
      file.type === 'message/rfc822' ||
      file.type === 'message/rfc822-eml'
    const isMsg = lowerName.endsWith('.msg') || file.type === 'application/vnd.ms-outlook'
    if (!isPdf && !isEml && !isMsg) {
      message.error(`${file.name} is not a PDF, EML, or MSG file`)
      return Upload.LIST_IGNORE
    }

    setFiles((prev) => {
      const exists = prev.some((f) => f.uid === file.uid || f.name === file.name)
      if (exists) return prev
      return [...prev, file]
    })
    return false
  }

  const handleRemove = (file) => {
    setFiles((prev) => prev.filter((f) => f.uid !== file.uid))
  }

  const clearFiles = () => {
    setFiles([])
  }

  const handleUpload = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!files.length) {
      message.error('Please select at least one PDF, EML, or MSG file.')
      return
    }

    const form = new FormData()
    files.forEach((file) => {
      const lowerName = String(file.name || '').toLowerCase()
      let fieldName = 'pdfFiles'
      if (lowerName.endsWith('.eml')) fieldName = 'emlFiles'
      else if (lowerName.endsWith('.msg')) fieldName = 'msgFiles'
      form.append(fieldName, file)
    })

    setUploading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/process/pdf/upload-pdf`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || 'Failed to upload PDF files')
      }

      message.success(data?.message || 'PDF files uploaded successfully')
      setFiles([])
      setCurrentView('list') // Switch back to list view on success
      setRefreshKey(prev => prev + 1)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to upload PDF files')
    } finally {
      setUploading(false)
    }
  }

  const handleDownloadPdfDataExcel = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }

    setDownloadingExcel(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/process/pdf/get-pdf-data-in-to-excel`, {
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

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <PageHeader 
        title="LEO Copy PDF" 
        description="Manage, fetch, and process PDF documents for automated data extraction."
        actions={
          currentView === 'upload' ? (
            <Button onClick={() => setCurrentView('list')} style={{ fontWeight: 500 }}>
              Cancel & Back to List
            </Button>
          ) : (
            <Space size={16} split={<div style={{ width: 1, height: 24, background: 'var(--exim-border-light)' }} />}>
              <Space size={8} align="center">
                {/* <Text type="secondary" style={{ fontSize: 13 }}>Mails to process:</Text> */}
                <Space.Compact>
                  <Tooltip title={!mailboxReady ? "Configure Gmail/Outlook in PDF Setup first" : "Max emails to fetch (Leave blank for all)"}>
                    <InputNumber
                      min={1}
                      max={500}
                      placeholder="All"
                      value={mailboxMaxMessages}
                      onChange={(value) => setMailboxMaxMessages(value ?? null)}
                      disabled={mailboxFetching || mailboxStatusLoading || !mailboxReady}
                      style={{ width: 64 }}
                    />
                  </Tooltip>
                  <Button
                    onClick={() => setMailboxMaxMessages(1)}
                    disabled={mailboxFetching || mailboxStatusLoading || !mailboxReady}
                  >
                    1 only
                  </Button>
                  <Tooltip title={!mailboxReady ? "Activate Gmail/Outlook in PDF Setup to enable automated fetching" : "Fetch new PDFs from mailbox"}>
                    <Button
                      type="default"
                      icon={<CloudDownloadOutlined />}
                      loading={mailboxFetching}
                      onClick={handleFetchFromMailbox}
                      disabled={!BACKEND_URL || mailboxFetching || !mailboxReady || mailboxStatusLoading}
                    >
                      Fetch Mailbox
                    </Button>
                  </Tooltip>
                </Space.Compact>
              </Space>
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                onClick={() => setCurrentView('upload')}
                style={{ fontWeight: 500 }}
              >
                Upload Manual
              </Button>
            </Space>
          )
        }
      />

      <div style={{ padding: 0, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {currentView === 'upload' ? (
          /* Inline Flat Uploader View */
          <div style={{ background: '#fff', border: '1px solid var(--exim-border-light)', padding: 32, borderRadius: 8, flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Title level={4} style={{ marginTop: 0, marginBottom: 8, color: 'var(--exim-gray-800)' }}>
              Upload Documents
            </Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
              Select or drag and drop PDF files, EML files, or Outlook MSG files. Attachments will be automatically extracted.
            </Text>

            <Upload.Dragger
              accept=".pdf,application/pdf,.eml,message/rfc822,.msg,application/vnd.ms-outlook"
              multiple
              beforeUpload={handleBeforeUpload}
              onRemove={handleRemove}
              fileList={files}
              listType="text"
              showUploadList={false}
              style={{ padding: '40px 16px', background: '#f8fafc', borderColor: '#cbd5e1' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                <CloudUploadOutlined style={{ fontSize: 48, color: 'var(--exim-primary)' }} />
                <div style={{ textAlign: 'center' }}>
                  <p className="ant-upload-text" style={{ fontSize: 16, fontWeight: 500, color: 'var(--exim-gray-800)', margin: 0 }}>
                    Click or drag files to this area to upload
                  </p>
                  <p className="ant-upload-hint" style={{ fontSize: 13, color: 'var(--exim-gray-500)', marginTop: 8, marginBottom: 0 }}>
                    Supports single or bulk upload of PDF, EML, or MSG files.
                  </p>
                </div>
              </div>
            </Upload.Dragger>

            {files.length > 0 && (
              <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--exim-border-light)', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <Text strong style={{ fontSize: 14, color: 'var(--exim-gray-800)', display: 'block', marginBottom: 12 }}>
                  Selected Files ({files.length})
                </Text>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, overflowY: 'auto' }} className="custom-scrollbar">
                  {files.map(file => (
                    <div
                      key={file.uid}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 12px',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        fontSize: 13,
                        borderRadius: 4,
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }} title={file.name}>
                        {file.name}
                      </span>
                      <Button
                        type="text"
                        size="small"
                        icon={<CloseOutlined style={{ fontSize: 10 }} />}
                        onClick={() => handleRemove(file)}
                        style={{ height: 20, width: 20, minWidth: 20, padding: 0, color: 'var(--exim-gray-400)' }}
                        className="hover-text-red-500 hover-bg-red-50"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--exim-border-light)', display: 'flex', justifyContent: 'flex-end', gap: 16 }}>
              <Button onClick={clearFiles} disabled={uploading || !files.length} size="large">
                Clear Selection
              </Button>
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                loading={uploading}
                onClick={handleUpload}
                disabled={!files.length}
                size="large"
                style={{ fontWeight: 600 }}
              >
                Upload {files.length > 0 ? `${files.length} Files` : ''}
              </Button>
            </div>
          </div>
        ) : (
          /* Data Table View */
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {lastMailboxResult?.data && (
              <Card size="small" style={{ background: lastMailboxResult.success === false ? '#fffbe6' : '#f6ffed', borderColor: lastMailboxResult.success === false ? '#ffe58f' : '#b7eb8f', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
                  <div>
                    <Text strong style={{ display: 'block', fontSize: 14, marginBottom: 4, color: 'var(--exim-gray-800)' }}>
                      Mailbox Fetch Summary {lastMailboxResult.provider && <Tag color="blue" style={{ marginLeft: 8 }}>{String(lastMailboxResult.provider).toUpperCase()}</Tag>}
                    </Text>
                    {lastMailboxResult.message && (
                      <Text type="secondary" style={{ display: 'block', fontSize: 13, marginBottom: 12 }}>
                        {String(lastMailboxResult.message)}
                      </Text>
                    )}
                    <Space size="large" wrap>
                      <Space direction="vertical" size={0}>
                        <Text type="secondary" style={{ fontSize: 12 }}>Source Folder</Text>
                        <Text strong>{String(lastMailboxResult.data.fromMailboxName || lastMailboxResult.data.fromLabelName || '—')}</Text>
                      </Space>
                      <Space direction="vertical" size={0}>
                        <Text type="secondary" style={{ fontSize: 12 }}>Found</Text>
                        <Text strong>{String(lastMailboxResult.data.total_mails ?? 0)}</Text>
                      </Space>
                      <Space direction="vertical" size={0}>
                        <Text type="secondary" style={{ fontSize: 12 }}>Processed</Text>
                        <Text strong style={{ color: 'var(--exim-success)' }}>{String(lastMailboxResult.data.processed_mails ?? 0)}</Text>
                      </Space>
                      <Space direction="vertical" size={0}>
                        <Text type="secondary" style={{ fontSize: 12 }}>Skipped</Text>
                        <Text strong style={{ color: 'var(--exim-gray-500)' }}>{String(lastMailboxResult.data.skipped_mails ?? 0)}</Text>
                      </Space>
                      <Space direction="vertical" size={0}>
                        <Text type="secondary" style={{ fontSize: 12 }}>Failed</Text>
                        <Text strong style={{ color: 'var(--exim-danger)' }}>{String(lastMailboxResult.data.failed_mails ?? 0)}</Text>
                      </Space>
                      <Space direction="vertical" size={0}>
                        <Text type="secondary" style={{ fontSize: 12 }}>Data Rows Stored</Text>
                        <Text strong style={{ color: 'var(--exim-primary)' }}>{String(lastMailboxResult.data.stored_rows ?? 0)}</Text>
                      </Space>
                    </Space>
                  </div>
                  <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setLastMailboxResult(null)} />
                </div>
              </Card>
            )}

            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <ProDataTable
                columns={dynamicColumns}
                fetchData={fetchData}
                refreshKey={refreshKey}
                rowKey={(_, index) => `pdf-data-${index}`}
                globalSearchPlaceholder="Search PDF Data..."
                customToolbarActions={
                  <Space>
                    <Button
                      type="default"
                      icon={<DownloadOutlined />}
                      loading={downloadingExcel}
                      onClick={handleDownloadPdfDataExcel}
                      disabled={!BACKEND_URL || downloadingExcel}
                    >
                      Download PDF data (Excel)
                    </Button>
                    <Button
                      icon={<ReloadOutlined />}
                      onClick={() => setRefreshKey(prev => prev + 1)}
                    >
                      Refresh
                    </Button>
                  </Space>
                }
              />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
