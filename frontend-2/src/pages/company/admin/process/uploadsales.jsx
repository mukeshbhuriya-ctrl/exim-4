import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Layout, Space, Table, Typography, Upload, message } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

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
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [downloadingExcel, setDownloadingExcel] = useState(false)
  const [salesDataRows, setSalesDataRows] = useState([])
  const [salesDataLoading, setSalesDataLoading] = useState(false)
  const [salesDataPage, setSalesDataPage] = useState(1)
  const [salesDataLimit, setSalesDataLimit] = useState(SALES_DATA_DEFAULT_LIMIT)
  const [salesDataTotal, setSalesDataTotal] = useState(0)

  const fetchSalesData = useCallback(
    async (page, limit) => {
      if (!BACKEND_URL) return
      const p = clampSalesDataPage(page)
      const l = clampSalesDataLimit(limit)
      setSalesDataLoading(true)
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
        setSalesDataRows(rows)

        let total = 0
        if (data.pagination && typeof data.pagination === 'object') {
          const pg = data.pagination
          setSalesDataPage(clampSalesDataPage(pg.page ?? p))
          setSalesDataLimit(clampSalesDataLimit(pg.limit ?? l))
          total = Number(pg.total)
        } else {
          setSalesDataPage(p)
          setSalesDataLimit(l)
          const t = data.total ?? data.totalCount
          total = Number(t)
        }
        if (!Number.isFinite(total)) {
          total = rows.length
        }
        setSalesDataTotal(total)
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Failed to load sales data')
        setSalesDataRows([])
        setSalesDataTotal(0)
      } finally {
        setSalesDataLoading(false)
      }
    },
    [BACKEND_URL],
  )

  useEffect(() => {
    if (!BACKEND_URL) return
    fetchSalesData(1, SALES_DATA_DEFAULT_LIMIT)
  }, [BACKEND_URL, fetchSalesData])

  const salesDataColumns = useMemo(() => getTableColumnsFromRows(salesDataRows), [salesDataRows])

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
      fetchSalesData(1, salesDataLimit)
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
          <Space direction="vertical" size="middle" style={{ width: '100%', minWidth: 0 }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                Upload sales (Excel)
              </Title>
              <Text type="secondary">Select multiple Excel files (.xlsx, .xls) and upload them for processing.</Text>
            </div>

            <Upload.Dragger
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              multiple
              beforeUpload={handleBeforeUpload}
              onRemove={handleRemove}
              fileList={files}
              style={{ padding: 16 }}
            >
              <Title level={5} style={{ margin: 0 }}>
                Excel files
              </Title>
              <Text type="secondary">Drop one or many Excel files here</Text>
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
                  Sales data
                </Title>
                <Space wrap>
                  <Button type="primary" loading={uploading} onClick={handleUpload} disabled={uploading}>
                    Upload sales files
                  </Button>
                  <Button onClick={clearFiles} disabled={uploading || !files.length}>
                    Clear
                  </Button>
                  <Button
                    icon={<DownloadOutlined />}
                    loading={downloadingExcel}
                    onClick={handleDownloadSalesDataExcel}
                    disabled={!BACKEND_URL || downloadingExcel}
                  >
                    Download sales data (Excel)
                  </Button>
                  <Button
                    type="default"
                    icon={<ReloadOutlined />}
                    loading={salesDataLoading}
                    onClick={() => fetchSalesData(salesDataPage, salesDataLimit)}
                    disabled={!BACKEND_URL || salesDataLoading}
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
                  rowKey={(_, index) => `sales-data-${salesDataPage}-${index}`}
                  columns={salesDataColumns}
                  dataSource={salesDataRows}
                  loading={salesDataLoading}
                  sticky
                  pagination={{
                    current: salesDataPage,
                    pageSize: salesDataLimit,
                    total: salesDataTotal,
                    showSizeChanger: true,
                    pageSizeOptions: ['10', '20', '50', '100', '200', '500'],
                    showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}`,
                    onChange: (page, pageSize) => fetchSalesData(page, pageSize),
                    onShowSizeChange: (_, size) => fetchSalesData(1, size),
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
