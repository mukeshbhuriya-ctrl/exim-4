import { CloudUploadOutlined, CloseOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Layout, Space, Table, Typography, Upload, message, Card } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
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
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }}>
        {/* Page Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Title level={4} style={{ margin: 0, color: 'var(--exim-gray-900)' }}>
              LEO Copy PDF
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Manage and process uploaded PDF documents.
            </Text>
          </div>
          {currentView === 'upload' && (
            <Button onClick={() => setCurrentView('list')} style={{ fontWeight: 500 }}>
              Cancel & Back to List
            </Button>
          )}
        </div>

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
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <ProDataTable
              columns={dynamicColumns}
              fetchData={fetchData}
              refreshKey={refreshKey}
              onExport={handleDownloadPdfDataExcel}
              rowKey={(_, index) => `pdf-data-${index}`}
              globalSearchPlaceholder="Search PDF Data..."
              customToolbarActions={
                <Space>
                  <Button
                    type="primary"
                    icon={<CloudUploadOutlined />}
                    onClick={() => setCurrentView('upload')}
                    style={{ fontWeight: 500 }}
                  >
                    Upload New PDFs
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
        )}
      </div>
    </AppShell>
  )
}
