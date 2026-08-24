import { CloseOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Layout, Space, Table, Typography, Upload, message } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

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
  const [pdfDataRows, setPdfDataRows] = useState([])
  const [pdfDataLoading, setPdfDataLoading] = useState(false)
  const [pdfDataPage, setPdfDataPage] = useState(1)
  const [pdfDataLimit, setPdfDataLimit] = useState(PDF_DATA_DEFAULT_LIMIT)
  const [pdfDataTotal, setPdfDataTotal] = useState(0)

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
        const res = await fetch(`${BACKEND_URL}/api/company/admin/process/pdf/get-pdf-data?${params}`, {
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

  useEffect(() => {
    if (!BACKEND_URL) return
    fetchPdfData(1, PDF_DATA_DEFAULT_LIMIT)
  }, [BACKEND_URL, fetchPdfData])

  const pdfDataColumns = useMemo(() => getTableColumnsFromRows(pdfDataRows), [pdfDataRows])

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
      fetchPdfData(1, pdfDataLimit)
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
          <Space direction="vertical" size="middle" style={{ width: '100%', minWidth: 0 }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                Upload PDF
              </Title>
              <Text type="secondary">
                Select PDF files, EML files, or Outlook MSG files (PDF attachments are extracted from mail).
              </Text>
            </div>

            <Upload.Dragger
              accept=".pdf,application/pdf,.eml,message/rfc822,.msg,application/vnd.ms-outlook"
              multiple
              beforeUpload={handleBeforeUpload}
              onRemove={handleRemove}
              fileList={files}
              listType="text"
              showUploadList={{ showPreviewIcon: false }}
              styles={{
                list: {
                  display: 'flex',
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginTop: 12,
                },
                item: {
                  marginTop: 0,
                  marginInlineEnd: 0,
                  marginInlineStart: 0,
                },
              }}
              itemRender={(_, file, __, { remove }) => (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    boxSizing: 'border-box',
                    maxWidth: 'min(100%, 280px)',
                    padding: '4px 10px',
                    background: '#fafafa',
                    border: '1px solid #f0f0f0',
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                      flex: 1,
                    }}
                    title={file.name}
                  >
                    {file.name}
                  </span>
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    aria-label={`Remove ${file.name}`}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      remove()
                    }}
                    style={{ flexShrink: 0, padding: '0 4px', height: 24 }}
                  />
                </div>
              )}
              style={{ padding: 16 }}
            >
              <Title level={5} style={{ margin: 0 }}>
                PDF / EML / MSG files
              </Title>
              <Text type="secondary">Drop PDF, .eml, or .msg files here</Text>
            </Upload.Dragger>

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
                  <Button type="primary" loading={uploading} onClick={handleUpload} disabled={uploading}>
                    Upload PDF
                  </Button>
                  <Button onClick={clearFiles} disabled={uploading || !files.length}>
                    Clear
                  </Button>
                  <Button
                    icon={<DownloadOutlined />}
                    loading={downloadingExcel}
                    onClick={handleDownloadPdfDataExcel}
                    disabled={!BACKEND_URL || downloadingExcel}
                  >
                    Download PDF data (Excel)
                  </Button>
                  <Button
                    type="default"
                    icon={<ReloadOutlined />}
                    loading={pdfDataLoading}
                    onClick={() => fetchPdfData(pdfDataPage, pdfDataLimit)}
                    disabled={!BACKEND_URL || pdfDataLoading}
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
