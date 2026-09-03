import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Input,
  Space,
  Tag,
  Typography,
  message,
} from 'antd'
import { useCallback, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import ProDataTable from '../../../../components/shared/ProDataTable.jsx'

const { Title, Text } = Typography

const PDF_API = '/api/company/admin/pdf/dgft'

function fileNameFromUrl(url, fallback = 'ebrc.pdf') {
  try {
    const path = new URL(url).pathname
    const name = path.split('/').filter(Boolean).pop()
    if (name) return decodeURIComponent(name)
  } catch {
    /* ignore */
  }
  return fallback
}

export default function CompanyAdminDgftPdfPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const fetchPdfGrid = useCallback(async (pageNum = 1, limit = 20) => {
    if (!BACKEND_URL) return { data: [], meta: { total: 0 } }
    try {
      const qs = new URLSearchParams({
        page: String(pageNum),
        limit: String(limit),
      })
      if (appliedSearch) qs.set('search', appliedSearch)

      const res = await fetch(`${BACKEND_URL}${PDF_API}?${qs}`, {
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Failed to load (${res.status})`)
      }

      return {
        data: Array.isArray(data.rows) ? data.rows : [],
        meta: { total: typeof data.total === 'number' ? data.total : 0 }
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load DGFT PDFs')
      return { data: [], meta: { total: 0 } }
    }
  }, [BACKEND_URL, appliedSearch])

  const applySearch = () => {
    setAppliedSearch(searchInput.trim())
    setRefreshKey(prev => prev + 1)
  }

  const clearSearch = () => {
    setSearchInput('')
    setAppliedSearch('')
    setRefreshKey(prev => prev + 1)
  }

  const handleDownload = useCallback((row) => {
    const url = String(row?.pdfUrl || '').trim()
    if (!url) {
      message.warning('PDF URL is not available for this row.')
      return
    }
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.download = fileNameFromUrl(
      url,
      `${row.brcNumber || row.sbNumber || 'ebrc'}.pdf`,
    )
    document.body.appendChild(a)
    a.click()
    a.remove()
  }, [])

  const columns = useMemo(
    () => [
      {
        title: 'Port',
        dataIndex: 'port',
        key: 'port',
        render: (v) => v || '—',
      },
      {
        title: 'SB Number',
        dataIndex: 'sbNumber',
        key: 'sbNumber',
        render: (v) => <Text strong>{v || '—'}</Text>,
      },
      {
        title: 'SB Date',
        dataIndex: 'sbDate',
        key: 'sbDate',
        render: (v) => v || '—',
      },
      {
        title: 'BRC Number',
        dataIndex: 'brcNumber',
        key: 'brcNumber',
        render: (v) => v || '—',
      },
      {
        title: 'Day',
        dataIndex: 'dayKey',
        key: 'dayKey',
        render: (v) => v || '—',
      },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        render: (v) => (
          <Tag color={v === 'success' ? 'success' : v === 'error' ? 'error' : 'default'}>
            {v || '—'}
          </Tag>
        ),
      },
      {
        title: '',
        key: 'pdf',
        width: 120,
        fixed: 'right',
        render: (_, row) => (
          <Button
            type="primary"
            size="small"
            icon={<DownloadOutlined />}
            disabled={!row.pdfUrl}
            onClick={() => handleDownload(row)}
          >
            Download
          </Button>
        ),
      },
    ],
    [handleDownload],
  )

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: '100%' }}>
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
            <Title level={5} style={{ margin: 0 }}>DGFT eBRC PDFs</Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              View DGFT records with BRC PDF links and download the PDF for each shipping bill.
            </Text>
          </div>
        </div>

        {!BACKEND_URL ? (
          <Alert type="error" showIcon message="VITE_BACKEND_URL is not configured." />
        ) : null}

        <div style={{ width: '100%', minWidth: 0 }}>
          <ProDataTable
            columns={columns}
            fetchData={fetchPdfGrid}
            refreshKey={refreshKey}
            rowKey="id"
            globalSearchPlaceholder="Search DGFT PDFs..."
            showSelectionColumn={false}
            customToolbarActions={
              <Space size={12} align="center">
                <Input.Search
                  placeholder="Search by SB No, BRC No, or Port"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onSearch={applySearch}
                  enterButton="Search"
                  style={{ width: 320 }}
                  allowClear
                  onClear={clearSearch}
                />
                <Button onClick={clearSearch} disabled={!appliedSearch && !searchInput}>
                  Clear
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => setRefreshKey(prev => prev + 1)}
                >
                  Reload
                </Button>
                {appliedSearch ? (
                  <Text type="secondary">
                    Filter: <Text code>{appliedSearch}</Text>
                  </Text>
                ) : null}
              </Space>
            }
          />
        </div>
      </Space>
    </AppShell>
  )
}
