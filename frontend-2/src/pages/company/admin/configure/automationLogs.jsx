import { ReloadOutlined, RightOutlined, DownOutlined } from '@ant-design/icons'
import { Button, Layout, Select, Space, Tag, Typography, message, Row, Col, Card } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'
import ProDataTable from '../../../../components/shared/ProDataTable.jsx'

const { Title, Text } = Typography

const sectionCardStyle = {
  background: '#ffffff',
  borderRadius: 8,
  padding: 24,
  boxShadow: '0 1px 2px rgba(0,0,0,0.03), 0 1px 6px -1px rgba(0,0,0,0.02)',
  borderTop: '4px solid #1677ff',
}

const AUTOMATION_LOGS_URL = '/api/company/admin/configure/automation/get-automation-logs'
const SAP_MISSING_DATES_LOGS_URL = '/api/company/admin/configure/automation/sap-missing-dates-logs'

const PROCESS_ORDER = [
  '1_sales',
  '2_pdf',
  '3_process',
  '4_cha',
  '5_merge_cha_data',
  '6_sbonline',
  '7_dgft_bulk_download',
  '8_dgft',
  '10_jv',
]

const PROCESS_LABELS = {
  '1_sales': 'Sales',
  '2_pdf': 'PDF',
  '3_process': 'Process',
  '4_cha': 'CHA',
  '5_merge_cha_data': 'Merge CHA',
  '6_sbonline': 'SB Online',
  '7_dgft_bulk_download': 'DGFT bulk',
  '8_dgft': 'DGFT',
  '10_jv': 'JV',
}

const DAYS_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 60, label: 'Last 60 days' },
  { value: 90, label: 'Last 90 days' },
]

function statusTagColor(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'successful') return 'success'
  if (s === 'failed') return 'error'
  if (s === 'skip') return 'default'
  if (s === 'not_run') return 'default'
  return 'default'
}

function formatStatusLabel(status) {
  const s = String(status || 'unknown')
  return s.replace(/_/g, ' ')
}

function formatRanAt(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString()
}

function summaryText(summary) {
  if (summary == null) return null
  if (typeof summary === 'string') return summary
  if (typeof summary === 'object') {
    try {
      return JSON.stringify(summary, null, 2)
    } catch {
      return String(summary)
    }
  }
  return String(summary)
}

function normalizeLogs(payload) {
  if (!payload || typeof payload !== 'object') return []
  if (Array.isArray(payload.logs)) return payload.logs
  if (Array.isArray(payload.data?.logs)) return payload.data.logs
  return []
}

function StatusCell({ entry }) {
  if (!entry || typeof entry !== 'object') {
    return <Tag>—</Tag>
  }
  return (
    <Tag color={statusTagColor(entry.status)} style={{ margin: 0 }}>
      {formatStatusLabel(entry.status)}
    </Tag>
  )
}

export default function CompanyAdminConfigureAutomationLogsPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [days, setDays] = useState(30)
  const [refreshKey, setRefreshKey] = useState(0)
  const [sapMissing, setSapMissing] = useState(null)
  const [sapMissingLoading, setSapMissingLoading] = useState(false)

  const loadSapMissingDates = useCallback(async () => {
    if (!BACKEND_URL) return
    setSapMissingLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}${SAP_MISSING_DATES_LOGS_URL}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(
          data?.detail || data?.message || `Failed to load SAP missing dates (${res.status})`,
        )
      }
      setSapMissing(data)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load SAP missing dates')
      setSapMissing(null)
    } finally {
      setSapMissingLoading(false)
    }
  }, [BACKEND_URL, days])

  const fetchData = useCallback(async ({ page, limit, search }) => {
    if (!BACKEND_URL) return { data: [], meta: { total: 0 } }
    try {
      const params = new URLSearchParams({ days: String(days) })
      const res = await fetch(`${BACKEND_URL}${AUTOMATION_LOGS_URL}?${params}`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || 'Failed to load logs')
      }
      
      const allLogs = normalizeLogs(data)
      let filteredLogs = allLogs
      
      if (search) {
        const lowerSearch = search.toLowerCase()
        filteredLogs = allLogs.filter(log => String(log.date).toLowerCase().includes(lowerSearch))
      }
      
      const start = (page - 1) * limit
      const paginatedLogs = filteredLogs.slice(start, start + limit)
      
      return {
        data: paginatedLogs,
        meta: {
          total: filteredLogs.length,
          page,
          last_page: Math.ceil(filteredLogs.length / limit)
        }
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load automation logs')
      return { data: [], meta: { total: 0 } }
    }
  }, [BACKEND_URL, days])

  useEffect(() => {
    loadSapMissingDates()
  }, [loadSapMissingDates])

  const columns = useMemo(() => {
    const processColumns = PROCESS_ORDER.map((key) => ({
      title: PROCESS_LABELS[key] || key,
      key,
      width: 100,
      align: 'center',
      render: (_, row) => <StatusCell entry={row.processes?.[key]} />,
    }))

    return [
      {
        title: 'Date',
        dataIndex: 'date',
        key: 'date',
        fixed: 'left',
        width: 120,
        render: (value) => <Text strong>{value || '—'}</Text>,
      },
      ...processColumns,
    ]
  }, [])

  const expandedRowRender = (row) => {
    const processes = row?.processes && typeof row.processes === 'object' ? row.processes : {}
    return (
      <Space direction="vertical" size="middle" style={{ width: '100%', padding: '12px 24px' }}>
        {PROCESS_ORDER.map((key) => {
          const entry = processes[key]
          if (!entry) return null
          const summary = summaryText(entry.summary)
          return (
            <div
              key={`${row.date}-${key}`}
              style={{
                border: '1px solid #f0f0f0',
                borderRadius: 8,
                padding: '12px 16px',
                background: '#ffffff',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: entry.error || summary ? 12 : 0, flexWrap: 'wrap', gap: 12 }}>
                <Space size={12}>
                  <Text strong style={{ fontSize: 14 }}>{PROCESS_LABELS[key] || key}</Text>
                  <StatusCell entry={entry} />
                </Space>
                <Text type="secondary" style={{ fontSize: 13 }}>Ran at: {formatRanAt(entry.ranAt)}</Text>
              </div>
              {entry.error ? (
                <Text type="danger" style={{ display: 'block', whiteSpace: 'pre-wrap', marginTop: 8 }}>
                  {String(entry.error)}
                </Text>
              ) : null}
              {summary ? (
                <pre
                  style={{
                    margin: 0,
                    padding: '12px',
                    background: '#f9f9f9',
                    border: '1px solid #f0f0f0',
                    borderRadius: 6,
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 250,
                    overflow: 'auto',
                    color: 'var(--exim-gray-700)'
                  }}
                >
                  {summary}
                </pre>
              ) : null}
            </div>
          )
        })}
        {row.updatedAt ? (
          <Text type="secondary" style={{ fontSize: 12, display: 'block', textAlign: 'right' }}>
            Log updated: {formatRanAt(row.updatedAt)}
          </Text>
        ) : null}
      </Space>
    )
  }

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1)
    loadSapMissingDates()
  }

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <PageHeader 
        title="Automation Logs" 
        description="Daily execution status and detailed summaries for all automated background processes."
        actions={
          <Space>
            <Select
              value={days}
              onChange={(val) => {
                setDays(val)
                setRefreshKey(prev => prev + 1)
              }}
              options={DAYS_OPTIONS}
              style={{ width: 140 }}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
              loading={sapMissingLoading}
            >
              Refresh
            </Button>
          </Space>
        }
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%' }}>
        
        {/* SAP Missing Dates Section */}
        <Card
          size="small"
          title="SAP missing dates"
          loading={sapMissingLoading}
          style={{ width: '100%', borderRadius: 8, borderColor: '#f0f0f0' }}
        >
          {sapMissing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              <Space wrap size={[12, 4]}>
                <Text type="secondary">
                  Range: {sapMissing.from || '—'} → {sapMissing.to || '—'}
                </Text>
                <Text type="secondary">
                  Missing: <Text strong>{sapMissing.missing_dates?.length ?? 0}</Text>
                </Text>
                <Text type="secondary">
                  Received: {sapMissing.received_dates?.length ?? 0} / {sapMissing.total_days ?? 0}
                </Text>
                {sapMissing.data_start_from ? (
                  <Text type="secondary">From: {sapMissing.data_start_from}</Text>
                ) : null}
              </Space>
              {Array.isArray(sapMissing.missing_dates) && sapMissing.missing_dates.length ? (
                <Space wrap size={[4, 4]}>
                  {sapMissing.missing_dates.map((date) => (
                    <Tag key={date} color="error">
                      {date}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <Text type="secondary">No missing SAP dates in this range.</Text>
              )}
            </div>
          ) : (
            <Text type="secondary">No SAP missing-date summary yet.</Text>
          )}
        </Card>

        {/* ProDataTable Section */}
        <div style={{ ...sectionCardStyle, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '24px 24px 0 24px' }}>
            <Title level={5} style={{ margin: 0, color: 'var(--exim-gray-800)' }}>
              Execution Logs
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Expand any row to view full JSON output and detailed error summaries.
            </Text>
          </div>
          <ProDataTable
            columns={columns}
            fetchData={fetchData}
            refreshKey={refreshKey}
            rowKey={(row) => String(row.date)}
            showSelectionColumn={false}
            globalSearchPlaceholder="Search by Date..."
            expandable={{
              expandedRowRender,
              rowExpandable: (row) => Boolean(row?.processes && typeof row.processes === 'object'),
              expandIcon: ({ expanded, onExpand, record }) =>
                expanded ? (
                  <DownOutlined
                    onClick={(e) => onExpand(record, e)}
                    style={{ fontSize: 13, cursor: 'pointer', padding: 4, color: 'var(--exim-gray-600)' }}
                  />
                ) : (
                  <RightOutlined
                    onClick={(e) => onExpand(record, e)}
                    style={{ fontSize: 13, cursor: 'pointer', padding: 4, color: 'var(--exim-gray-500)' }}
                  />
                )
            }}
          />
        </div>
      </div>
    </AppShell>
  )
}
