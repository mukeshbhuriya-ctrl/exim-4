import { DownloadOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Input,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'

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

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)

  const loadRows = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoading(true)
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      })
      if (appliedSearch) qs.set('search', appliedSearch)

      const res = await fetch(`${BACKEND_URL}${PDF_API}?${qs}`, {
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Failed to load (${res.status})`)
      }

      setRows(Array.isArray(data.rows) ? data.rows : [])
      setTotal(typeof data.total === 'number' ? data.total : 0)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load DGFT PDFs')
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [BACKEND_URL, page, pageSize, appliedSearch])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  const applySearch = () => {
    setPage(1)
    setAppliedSearch(searchInput.trim())
  }

  const clearSearch = () => {
    setSearchInput('')
    setAppliedSearch('')
    setPage(1)
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
        width: 100,
        render: (v) => v || '—',
      },
      {
        title: 'SB Number',
        dataIndex: 'sbNumber',
        key: 'sbNumber',
        width: 140,
        render: (v) => <Text strong>{v || '—'}</Text>,
      },
      {
        title: 'SB Date',
        dataIndex: 'sbDate',
        key: 'sbDate',
        width: 120,
        render: (v) => v || '—',
      },
      {
        title: 'BRC Number',
        dataIndex: 'brcNumber',
        key: 'brcNumber',
        width: 200,
        render: (v) => v || '—',
      },
      {
        title: 'Day',
        dataIndex: 'dayKey',
        key: 'dayKey',
        width: 110,
        render: (v) => v || '—',
      },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        width: 100,
        render: (v) => (
          <Tag color={v === 'success' ? 'success' : v === 'error' ? 'error' : 'default'}>
            {v || '—'}
          </Tag>
        ),
      },
      {
        title: 'PDF',
        key: 'pdf',
        width: 130,
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
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            DGFT eBRC PDFs
          </Title>
          <Text type="secondary">
            View DGFT records with BRC PDF links and download the PDF for each shipping bill.
          </Text>
        </div>

        {!BACKEND_URL ? (
          <Alert type="error" showIcon message="VITE_BACKEND_URL is not configured." />
        ) : null}

        <Card size="small">
          <Space wrap>
            <Input
              allowClear
              placeholder="Search by SB No, BRC No, or Port"
              style={{ minWidth: 280 }}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onPressEnter={applySearch}
              prefix={<SearchOutlined />}
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={applySearch} loading={loading}>
              Search
            </Button>
            <Button onClick={clearSearch} disabled={!appliedSearch && !searchInput}>
              Clear
            </Button>
            <Button icon={<ReloadOutlined />} onClick={loadRows} loading={loading}>
              Reload
            </Button>
            {appliedSearch ? (
              <Text type="secondary">
                Filter: <Text code>{appliedSearch}</Text>
              </Text>
            ) : null}
            <Text type="secondary">{total} PDF record(s)</Text>
          </Space>
        </Card>

        <Card size="small" styles={{ body: { padding: 0 } }}>
          <Table
            size="small"
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={rows}
            scroll={{ x: 'max-content' }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50', '100'],
              showTotal: (t) => `${t} PDF records`,
              onChange: (p, size) => {
                setPage(p)
                setPageSize(size)
              },
            }}
            locale={{ emptyText: 'No DGFT PDF records found' }}
          />
        </Card>
      </Space>
    </AppShell>
  )
}
