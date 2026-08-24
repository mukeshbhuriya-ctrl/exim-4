import { EyeOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  DatePicker,
  Descriptions,
  Layout,
  Modal,
  Select,
  Space,
  Table,
  Typography,
  message,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import SiteAdminSidebar from '../../components/siteadmin/sidebar.jsx'
import AppShell from '../../components/layout/AppShell.jsx'

const { Content } = Layout
const { Title, Text } = Typography

function normalizeCompanies(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.companies)) return payload.companies
    if (Array.isArray(payload.data)) return payload.data
    if (payload.data && typeof payload.data === 'object' && Array.isArray(payload.data.companies)) {
      return payload.data.companies
    }
  }
  return []
}

function normalizeReports(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.rows)) return payload.rows
    if (Array.isArray(payload.data)) return payload.data
    if (payload.data && typeof payload.data === 'object' && Array.isArray(payload.data.rows)) {
      return payload.data.rows
    }
  }
  return []
}

function normalizeDetailRows(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    if (payload.row && typeof payload.row === 'object' && Array.isArray(payload.row.billedRows)) {
      return payload.row.billedRows
    }
    if (Array.isArray(payload.rows)) return payload.rows
    if (payload.data && typeof payload.data === 'object') {
      if (payload.data.row && typeof payload.data.row === 'object' && Array.isArray(payload.data.row.billedRows)) {
        return payload.data.row.billedRows
      }
      if (Array.isArray(payload.data.rows)) return payload.data.rows
      if (Array.isArray(payload.data.billedRows)) return payload.data.billedRows
    }
    if (Array.isArray(payload.billedRows)) return payload.billedRows
  }
  return []
}

export default function SiteAdminViewBillesPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [companies, setCompanies] = useState([])
  const [companyId, setCompanyId] = useState(undefined)
  const [dateRange, setDateRange] = useState(() => [dayjs().startOf('month'), dayjs().endOf('month')])
  const [rows, setRows] = useState([])
  const [loadingCompanies, setLoadingCompanies] = useState(false)
  const [loadingReports, setLoadingReports] = useState(false)
  const [error, setError] = useState('')

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailHeader, setDetailHeader] = useState(null)
  const [detailRows, setDetailRows] = useState([])

  const fetchCompanies = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoadingCompanies(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/siteadmin/company/`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || data?.detail || `Failed to load companies (${res.status})`)
      }
      const list = normalizeCompanies(data).filter((r) => r && typeof r === 'object')
      setCompanies(list)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load companies')
    } finally {
      setLoadingCompanies(false)
    }
  }, [BACKEND_URL])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  const handleSearch = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    const [start, end] = dateRange || []
    setLoadingReports(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (companyId) params.set('companyId', String(companyId))
      if (start && dayjs.isDayjs(start)) params.set('startDate', start.format('YYYY-MM-DD'))
      if (end && dayjs.isDayjs(end)) params.set('endDate', end.format('YYYY-MM-DD'))

      const res = await fetch(`${BACKEND_URL}/api/siteadmin/billing/billing-report?${params}`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || data?.detail || `Failed to load billing reports (${res.status})`)
      const list = normalizeReports(data).filter((r) => r && typeof r === 'object')
      setRows(list)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load billing reports'
      setError(msg)
      setRows([])
      message.error(msg)
    } finally {
      setLoadingReports(false)
    }
  }, [BACKEND_URL, companyId, dateRange])

  const openDetail = useCallback(
    async (id) => {
      if (!BACKEND_URL || !id) return
      setDetailOpen(true)
      setDetailLoading(true)
      setDetailHeader(null)
      setDetailRows([])
      try {
        const res = await fetch(`${BACKEND_URL}/api/siteadmin/billing/detailed-billing-report/${id}`, {
          method: 'GET',
          credentials: 'include',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.message || data?.detail || `Failed to load detailed report (${res.status})`)
        }
        const header =
          data?.row ||
          data?.data?.row ||
          data?.header ||
          data?.report ||
          data?.data?.header ||
          data?.data?.report ||
          data?.data ||
          data
        setDetailHeader(header && typeof header === 'object' ? header : null)
        setDetailRows(normalizeDetailRows(data).filter((r) => r && typeof r === 'object'))
      } catch (e) {
        message.error(e instanceof Error ? e.message : 'Failed to load detailed billing report')
      } finally {
        setDetailLoading(false)
      }
    },
    [BACKEND_URL],
  )

  const companyOptions = useMemo(
    () =>
      companies.map((c) => ({
        value: String(c.id || c._id),
        label: c.name || c.companyName || String(c.id || c._id),
      })),
    [companies],
  )

  const reportColumns = [
    { title: 'Index', key: 'index', width: 80, render: (_, __, i) => i + 1 },
    { title: 'companyName', dataIndex: 'companyName', key: 'companyName', width: 180 },
    { title: 'feeNoteNo', dataIndex: 'feeNoteNo', key: 'feeNoteNo', width: 160 },
    { title: 'dayKey', dataIndex: 'dayKey', key: 'dayKey', width: 130 },
    { title: 'perRowAmount', dataIndex: 'perRowAmount', key: 'perRowAmount', width: 130 },
    { title: 'totalAmount', dataIndex: 'totalAmount', key: 'totalAmount', width: 130 },
    { title: 'rowsCount', dataIndex: 'rowsCount', key: 'rowsCount', width: 110 },
    { title: 'createdAt', dataIndex: 'createdAt', key: 'createdAt', width: 180 },
    { title: 'updatedAt', dataIndex: 'updatedAt', key: 'updatedAt', width: 180 },
    {
      title: 'Action',
      key: 'action',
      width: 90,
      render: (_, row) => (
        <Button type="link" icon={<EyeOutlined />} onClick={() => openDetail(row?.id || row?._id)}>
          View
        </Button>
      ),
    },
  ]

  const detailColumns = [
    { title: 'Index', key: 'index', width: 80, render: (_, __, i) => i + 1 },
    { title: 'sbnumber', dataIndex: 'sbnumber', key: 'sbnumber', width: 160 },
    { title: 'sbdate', dataIndex: 'sbdate', key: 'sbdate', width: 140 },
    { title: 'sbport', dataIndex: 'sbport', key: 'sbport', width: 180 },
    { title: 'billingstatus', dataIndex: 'billingstatus', key: 'billingstatus', width: 160 },
  ]

  return (
    <AppShell sidebar={<SiteAdminSidebar />} portalType="siteadmin">
          <Space direction="vertical" size="large" style={{ width: '100%', minWidth: 0 }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                View Billes
              </Title>
              <Text type="secondary">View billing reports and detailed billed rows.</Text>
            </div>

            {error ? <Alert type="error" message={error} showIcon /> : null}

            <Space wrap style={{ width: '100%' }}>
              <Select
                style={{ minWidth: 260 }}
                placeholder="Select company (optional)"
                value={companyId}
                onChange={setCompanyId}
                options={companyOptions}
                loading={loadingCompanies}
                allowClear
                showSearch
                optionFilterProp="label"
              />
              <DatePicker.RangePicker
                value={dateRange}
                onChange={(v) => setDateRange(v)}
                format="YYYY-MM-DD"
              />
              <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} loading={loadingReports}>
                Search
              </Button>
              <Button icon={<ReloadOutlined />} onClick={fetchCompanies} loading={loadingCompanies}>
                Refresh Companies
              </Button>
            </Space>

            <div style={{ width: '100%', maxWidth: '100%', minWidth: 0, overflowX: 'auto', overflowY: 'hidden' }}>
              <Table
                rowKey={(r, i) => String(r?.id || r?._id || `billing-report-${i}`)}
                columns={reportColumns}
                dataSource={rows}
                loading={loadingReports}
                pagination={{ pageSize: 25, showSizeChanger: true }}
                scroll={{ x: 'max-content' }}
                size="small"
              />
            </div>

            <Modal
              title="Detailed Billing Report"
              open={detailOpen}
              onCancel={() => setDetailOpen(false)}
              footer={null}
              width={1100}
              destroyOnClose
            >
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {detailHeader ? (
                  <Descriptions bordered size="small" column={2}>
                    <Descriptions.Item label="company">
                      {String(detailHeader?.companyName ?? detailHeader?.companyId ?? '—')}
                    </Descriptions.Item>
                    <Descriptions.Item label="feeNoteNo">
                      {String(detailHeader?.feeNoteNo ?? '—')}
                    </Descriptions.Item>
                    <Descriptions.Item label="dayKey">
                      {String(detailHeader?.dayKey ?? '—')}
                    </Descriptions.Item>
                    <Descriptions.Item label="perRowAmount">
                      {String(detailHeader?.perRowAmount ?? '—')}
                    </Descriptions.Item>
                    <Descriptions.Item label="totalAmount">
                      {String(detailHeader?.totalAmount ?? '—')}
                    </Descriptions.Item>
                    <Descriptions.Item label="rowsCount">
                      {String(detailHeader?.rowsCount ?? detailRows.length)}
                    </Descriptions.Item>
                  </Descriptions>
                ) : null}
                <Table
                  rowKey={(r, i) => `${r?.sbnumber || 'sb'}-${r?.sbdate || 'date'}-${r?.sbport || 'port'}-${i}`}
                  columns={detailColumns}
                  dataSource={detailRows}
                  loading={detailLoading}
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                  scroll={{ x: 'max-content' }}
                  size="small"
                />
              </Space>
            </Modal>
          </Space>
    </AppShell>
  )
}
