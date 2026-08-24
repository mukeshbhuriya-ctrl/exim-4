import { ReloadOutlined } from '@ant-design/icons'
import { Button, Card, Layout, Select, Space, Table, Tag, Typography, message } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography

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
  if (s === 'not_run') return 'warning'
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
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [sapMissing, setSapMissing] = useState(null)
  const [sapMissingLoading, setSapMissingLoading] = useState(false)

  const loadLogs = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ days: String(days) })
      const res = await fetch(`${BACKEND_URL}${AUTOMATION_LOGS_URL}?${params}`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load automation logs (${res.status})`)
      }
      setLogs(normalizeLogs(data))
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load automation logs')
      setLogs([])
    } finally {
      setLoading(false)
    }
  }, [BACKEND_URL, days])

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

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  useEffect(() => {
    loadSapMissingDates()
  }, [loadSapMissingDates])

  const columns = useMemo(() => {
    const processColumns = PROCESS_ORDER.map((key) => ({
      title: PROCESS_LABELS[key] || key,
      key,
      width: 96,
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
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
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
                padding: '10px 12px',
                background: '#fafafa',
              }}
            >
              <Space wrap size={[8, 4]} style={{ marginBottom: 6 }}>
                <Text strong>{PROCESS_LABELS[key] || key}</Text>
                <StatusCell entry={entry} />
                <Text type="secondary">Ran at: {formatRanAt(entry.ranAt)}</Text>
              </Space>
              {entry.error ? (
                <Text type="danger" style={{ display: 'block', whiteSpace: 'pre-wrap' }}>
                  {String(entry.error)}
                </Text>
              ) : null}
              {summary ? (
                <pre
                  style={{
                    margin: entry.error ? '8px 0 0' : 0,
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 200,
                    overflow: 'auto',
                  }}
                >
                  {summary}
                </pre>
              ) : null}
            </div>
          )
        })}
        {row.updatedAt ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Log updated: {formatRanAt(row.updatedAt)}
          </Text>
        ) : null}
      </Space>
    )
  }

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
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
                  Automation logs
                </Title>
                <Text type="secondary">
                  Daily status for automated jobs: sales, PDF, process match, CHA, merge CHA, SB online, and DGFT.
                </Text>
              </div>
              <Space wrap>
                <Select
                  value={days}
                  onChange={setDays}
                  options={DAYS_OPTIONS}
                  style={{ width: 160 }}
                  disabled={loading}
                />
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    loadLogs()
                    loadSapMissingDates()
                  }}
                  loading={loading || sapMissingLoading}
                  disabled={!BACKEND_URL}
                >
                  Refresh
                </Button>
              </Space>
            </div>

            <Card
              size="small"
              title="SAP missing dates"
              loading={sapMissingLoading}
            >
              {sapMissing ? (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
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
                        <Tag key={date} color="warning">
                          {date}
                        </Tag>
                      ))}
                    </Space>
                  ) : (
                    <Text type="secondary">No missing SAP dates in this range.</Text>
                  )}
                </Space>
              ) : (
                <Text type="secondary">No SAP missing-date summary yet.</Text>
              )}
            </Card>

            <Table
              rowKey={(row) => String(row.date)}
              columns={columns}
              dataSource={logs}
              loading={loading}
              pagination={{ pageSize: 15, showSizeChanger: true, pageSizeOptions: ['15', '30', '60'] }}
              scroll={{ x: 'max-content' }}
              size="small"
              expandable={{
                expandedRowRender,
                rowExpandable: (row) =>
                  Boolean(row?.processes && typeof row.processes === 'object'),
              }}
            />
          </Space>
        </AppShell>
  )
}
