import { CloudUploadOutlined, CloseOutlined, DownloadOutlined, ReloadOutlined, FileExcelOutlined } from '@ant-design/icons'
import { Button, Layout, Space, Typography, Upload, message } from 'antd'
import { useCallback, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'
import ProDataTable from '../../../../components/shared/ProDataTable.jsx'
import { AccessControl } from '../../../../components/iam/AccessControl.jsx'

const { Content } = Layout
const { Title, Text } = Typography

const EXCEL_MIME =
  /^(application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel)$/

function isExcelFile(file) {
  const name = String(file?.name || '').toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return true
  return EXCEL_MIME.test(file?.type || '')
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

const SALES_DATA_DEFAULT_LIMIT = 50
const SALES_DATA_MAX_LIMIT = 500

function clampSalesDataPage(page) {
  const n = Number(page)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.floor(n)
}

function clampSalesDataLimit(limit) {
  const n = Number(limit)
  if (!Number.isFinite(n) || n < 1) return SALES_DATA_DEFAULT_LIMIT
  return Math.min(SALES_DATA_MAX_LIMIT, Math.max(1, Math.floor(n)))
}

function normalizeSalesDataRows(payload) {
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

export default function CompanyAdminUploadSalesPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')
  const [currentView, setCurrentView] = useState('list')
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [downloadingExcel, setDownloadingExcel] = useState(false)

  const [refreshKey, setRefreshKey] = useState(0)
  const [dynamicColumns, setDynamicColumns] = useState([])

  const fetchData = useCallback(
    async ({ page, limit }) => {
      if (!BACKEND_URL) return { data: [], meta: { total: 0 } }
      const p = clampSalesDataPage(page)
      const l = clampSalesDataLimit(limit)

      try {
        const params = new URLSearchParams({
          page: String(p),
          limit: String(l),
        })
        const res = await fetch(`${BACKEND_URL}/api/company/admin/process/sales/get-sales-data?${params}`, {
          method: 'GET',
          credentials: 'include',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.detail || data?.message || `Failed to load sales data (${res.status})`)
        }

        const rows = normalizeSalesDataRows(data).filter((r) => r && typeof r === 'object')

        setDynamicColumns(prev => {
          if (prev.length === 0 && rows.length > 0) {
            return getTableColumnsFromRows(rows)
          }
          return prev
        })

        let total = 0
        if (data.pagination && typeof data.pagination === 'object') {
          total = Number(data.pagination.total)
        } else {
          total = Number(data.total ?? data.totalCount)
        }
        if (!Number.isFinite(total)) {
          total = rows.length
        }

        return { data: rows, meta: { total } }
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Failed to load sales data')
        return { data: [], meta: { total: 0 } }
      }
    },
    [BACKEND_URL]
  )

  const handleBeforeUpload = (file) => {
    if (!isExcelFile(file)) {
      message.error(`${file.name} is not an Excel file (.xlsx or .xls)`)
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
      message.error('Please select at least one Excel file.')
      return
    }

    const form = new FormData()
    files.forEach((file) => {
      form.append('salesFiles', file)
    })

    setUploading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/process/sales/upload-sales-file`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || 'Failed to upload sales files')
      }

      message.success(data?.message || 'Sales files uploaded successfully')
      setFiles([])
      setCurrentView('list')
      setRefreshKey(prev => prev + 1)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to upload sales files')
    } finally {
      setUploading(false)
    }
  }

  const handleDownloadSalesDataExcel = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }

    setDownloadingExcel(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/process/sales/get-sales-data-in-to-excel`, {
        method: 'GET',
        credentials: 'include',
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.detail || err?.message || `Download failed (${res.status})`)
      }

      const blob = await res.blob()
      const headerName = fileNameFromContentDisposition(res.headers.get('Content-Disposition'))
      const fallbackName = `sales-data-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`
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
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 44, height: 44,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25)',
              border: '1px solid rgba(255,255,255,0.2)'
            }}>
              <FileExcelOutlined style={{ fontSize: 22 }} />
            </div>
            <span style={{ letterSpacing: '-0.5px' }}>Sales (Excel)</span>
          </div>
        }
        description="Select multiple Excel files and upload them for automated processing."
        actions={
          currentView === 'upload' ? (
            <Button onClick={() => setCurrentView('list')} style={{ fontWeight: 500 }}>
              Cancel & Back to List
            </Button>
          ) : (
            <Space size={16}>
              <AccessControl required="process:sales:upload">
                <Button
                  type="primary"
                  icon={<CloudUploadOutlined />}
                  onClick={() => setCurrentView('upload')}
                  style={{
                    fontWeight: 600,
                    height: 38,
                    padding: '0 20px',
                    borderRadius: 8,
                    boxShadow: '0 2px 8px rgba(16, 185, 129, 0.15)',
                    background: 'linear-gradient(180deg, #10b981 0%, #059669 100%)',
                    border: 'none'
                  }}
                >
                  Upload Manual
                </Button>
              </AccessControl>

            </Space>
          )
        }
      />

      <div style={{ padding: 0, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {currentView === 'upload' ? (
          /* Inline Flat Uploader View */
          <div style={{ background: '#fff', border: '1px solid var(--exim-border-light)', padding: 32, borderRadius: 8, flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Title level={4} style={{ marginTop: 0, marginBottom: 8, color: 'var(--exim-gray-800)' }}>
              Sales Files
            </Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
              Drop one or many Excel files (.xlsx, .xls) here to process sales data.
            </Text>

            <Upload.Dragger
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
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
                    Supports bulk upload of Excel spreadsheets.
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
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--exim-border-light)', display: 'flex', justifyContent: 'flex-end', gap: 16 }}>
              <Button onClick={clearFiles} disabled={uploading || !files.length} size="large">
                Clear All
              </Button>
              <Button type="primary" loading={uploading} onClick={handleUpload} disabled={uploading || !files.length} size="large" icon={<CloudUploadOutlined />}>
                Process Files
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
              rowKey={(_, index) => `sales-data-${index}`}
              globalSearchPlaceholder="Search Sales Data..."
              customToolbarActions={
                <Space>
                  <Button
                    type="default"
                    icon={<DownloadOutlined />}
                    loading={downloadingExcel}
                    onClick={handleDownloadSalesDataExcel}
                    disabled={!BACKEND_URL || downloadingExcel}
                  >
                    Download Sales Data (Excel)
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
