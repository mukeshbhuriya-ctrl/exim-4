import { useEffect, useState, useCallback, useMemo } from 'react'
import { Modal, Space, Spin, Tag, Typography, message } from 'antd'
import {
  FileTextOutlined,
  SyncOutlined,
  AuditOutlined,
  BankOutlined,
  BarChartOutlined,
  SettingOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  ControlOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import AppShell from '../../../components/layout/AppShell.jsx'
import CompanySidebar from '../../../components/company/sidebar.jsx'
import PageHeader from '../../../components/common/PageHeader.jsx'
import StatCard from '../../../components/common/StatCard.jsx'
import MatchPieChart from '../../../components/common/MatchPieChart.jsx'
import '../../../components/shared/ProDataTable.css'

const { Text, Title } = Typography

const EMPTY_MATCH_STATS = {
  matched: 0,
  unmatched: 0,
  partially_matched: 0,
  matchedList: [],
  unmatchedList: [],
  partially_matchedList: [],
}

const MATCH_STATUS_CARDS = [
  {
    key: 'matched',
    label: 'Matched',
    listKey: 'matchedList',
    icon: <CheckCircleOutlined />,
    color: 'var(--exim-success)',
  },
  {
    key: 'unmatched',
    label: 'Unmatched',
    listKey: 'unmatchedList',
    icon: <CloseCircleOutlined />,
    color: 'var(--exim-error)',
  },
  {
    key: 'partially_matched',
    label: 'Partially matched',
    listKey: 'partially_matchedList',
    icon: <ExclamationCircleOutlined />,
    color: 'var(--exim-warning)',
  },
]

function normalizeMatchDashboardPayload(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload
  if (!data || typeof data !== 'object') return { ...EMPTY_MATCH_STATS }

  return {
    matched: Number(data.matched) || 0,
    unmatched: Number(data.unmatched) || 0,
    partially_matched: Number(data.partially_matched) || 0,
    matchedList: Array.isArray(data.matchedList) ? data.matchedList : [],
    unmatchedList: Array.isArray(data.unmatchedList) ? data.unmatchedList : [],
    partially_matchedList: Array.isArray(data.partially_matchedList) ? data.partially_matchedList : [],
  }
}

function getMatchListLabels(list, idKey) {
  if (!Array.isArray(list)) return []
  return list
    .map((item) => {
      if (item == null) return ''
      if (typeof item !== 'object') return String(item)
      return String(item[idKey] ?? item.inv ?? item.sbNo ?? '').trim()
    })
    .filter(Boolean)
}

const QUICK_ACTIONS = [
  {
    key: 'process',
    icon: <SyncOutlined style={{ fontSize: 22, color: 'var(--exim-primary)' }} />,
    title: 'Start Process',
    description: 'Match sales and PDF data automatically',
    path: '/admin/start-process',
    color: 'var(--exim-primary-50)',
  },
  {
    key: 'header-mapping',
    icon: <FileTextOutlined style={{ fontSize: 22, color: '#7C3AED' }} />,
    title: 'Header Mapping',
    description: 'Configure data field mappings',
    path: '/admin/header-mapping',
    color: '#F5F3FF',
  },
  {
    key: 'shipping',
    icon: <AuditOutlined style={{ fontSize: 22, color: '#059669' }} />,
    title: 'Shipping Bills',
    description: 'Scrape and match SB records',
    path: '/admin/sb',
    color: 'var(--exim-success-light)',
  },
  {
    key: 'dgft',
    icon: <BankOutlined style={{ fontSize: 22, color: '#D97706' }} />,
    title: 'DGFT Records',
    description: 'Manage DGFT portal data',
    path: '/admin/dgft',
    color: 'var(--exim-warning-light)',
  },
  {
    key: 'reports',
    icon: <BarChartOutlined style={{ fontSize: 22, color: '#DC2626' }} />,
    title: 'Reports',
    description: 'Generate compliance reports',
    path: '/admin/reports',
    color: 'var(--exim-error-light)',
  },
  {
    key: 'configure',
    icon: <SettingOutlined style={{ fontSize: 22, color: '#6B7280' }} />,
    title: 'Configuration',
    description: 'SAP, PDF, and automation settings',
    path: '/admin/configure/automation',
    color: 'var(--exim-gray-100)',
  },
  {
    key: 'automation-logs',
    icon: <ControlOutlined style={{ fontSize: 22, color: '#2563EB' }} />,
    title: 'Automation Logs',
    description: 'View daily execution status and errors',
    path: '/admin/configure/automation-logs',
    color: '#EFF6FF',
  },
]

export default function CompanyAdminDashboardPage() {
  const navigate = useNavigate()
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [stats, setStats] = useState({
    headerMappingConfigured: false,
    combinationConfigured: false,
    connectionConfigured: false,
  })
  const [sapInvStats, setSapInvStats] = useState({ ...EMPTY_MATCH_STATS })
  const [pdfSbStats, setPdfSbStats] = useState({ ...EMPTY_MATCH_STATS })
  const [loadingMatchStats, setLoadingMatchStats] = useState(false)
  const [detailModal, setDetailModal] = useState({ open: false, title: '', items: [] })

  const openMatchDetails = useCallback((sectionTitle, statusLabel, list, idKey) => {
    const items = getMatchListLabels(list, idKey)
    setDetailModal({
      open: true,
      title: `${sectionTitle} — ${statusLabel}`,
      items,
    })
  }, [])

  const fetchMatchStats = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoadingMatchStats(true)
    try {
      const [sapRes, pdfRes] = await Promise.allSettled([
        fetch(`${BACKEND_URL}/api/company/admin/dashboard/get-sap-inv`, { credentials: 'include' }).then((r) =>
          r.json(),
        ),
        fetch(`${BACKEND_URL}/api/company/admin/dashboard/get-pdf-sb`, { credentials: 'include' }).then((r) =>
          r.json(),
        ),
      ])

      if (sapRes.status === 'fulfilled') {
        setSapInvStats(normalizeMatchDashboardPayload(sapRes.value))
      } else {
        setSapInvStats({ ...EMPTY_MATCH_STATS })
      }

      if (pdfRes.status === 'fulfilled') {
        setPdfSbStats(normalizeMatchDashboardPayload(pdfRes.value))
      } else {
        setPdfSbStats({ ...EMPTY_MATCH_STATS })
      }
    } catch {
      setSapInvStats({ ...EMPTY_MATCH_STATS })
      setPdfSbStats({ ...EMPTY_MATCH_STATS })
      message.error('Failed to load match statistics')
    } finally {
      setLoadingMatchStats(false)
    }
  }, [BACKEND_URL])

  const fetchDashboardData = useCallback(async () => {
    if (!BACKEND_URL) return
    try {
      const [headerRes, comboRes, connRes] = await Promise.allSettled([
        fetch(`${BACKEND_URL}/api/company/admin/header-mapping/`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
        fetch(`${BACKEND_URL}/api/company/admin/combination/`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
        fetch(`${BACKEND_URL}/api/company/admin/connection`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
      ])

      const headerData = headerRes.status === 'fulfilled' ? headerRes.value : null
      const comboData = comboRes.status === 'fulfilled' ? comboRes.value : null
      const connData = connRes.status === 'fulfilled' ? connRes.value : null

      const hasHeader = !!(headerData?.data || headerData?.mapping || headerData?.headerMapping)
      const comboList = comboData?.data || comboData?.combinations || comboData?.combination
      const hasCombo = Array.isArray(comboList) ? comboList.length > 0 : !!comboList
      const connList = connData?.data || connData?.connections || connData?.connection
      const hasConn = Array.isArray(connList) ? connList.length > 0 : !!connList

      setStats({
        headerMappingConfigured: hasHeader,
        combinationConfigured: hasCombo,
        connectionConfigured: hasConn,
      })
    } catch {
      // Silently fail — dashboard is informational
    }
  }, [BACKEND_URL])

  useEffect(() => {
    fetchDashboardData()
    fetchMatchStats()
  }, [fetchDashboardData, fetchMatchStats])

  const renderMatchStats = (title, subtitle, statsData, idKey) => (
    <div
      style={{
        flex: '1 1 360px',
        minWidth: 0,
        background: 'var(--exim-surface)',
        border: '1px solid var(--exim-border-light)',
        borderRadius: 'var(--radius-lg)',
        padding: 24,
        boxShadow: 'var(--shadow-xs)',
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--exim-text-primary)' }}>{title}</div>
        <Text style={{ color: 'var(--exim-text-secondary)', fontSize: 13 }}>{subtitle}</Text>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {MATCH_STATUS_CARDS.map((card) => (
          <StatCard
            key={card.key}
            title={card.label}
            value={statsData[card.key]}
            subtitle="Click to view list"
            icon={card.icon}
            color={card.color}
            style={{ flex: '1 1 100px', minWidth: 100 }}
            onClick={() => openMatchDetails(title, card.label, statsData[card.listKey], idKey)}
          />
        ))}
      </div>
    </div>
  )

  const renderMatchChart = (title, statsData, idKey) => (
    <div
      style={{
        background: 'var(--exim-surface)',
        border: '1px solid var(--exim-border-light)',
        borderRadius: 'var(--radius-lg)',
        padding: 24,
        boxShadow: 'var(--shadow-xs)',
      }}
    >
      <div style={{ marginBottom: 12, textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--exim-text-primary)' }}>{title}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <MatchPieChart
          stats={statsData}
          size={220}
          onSliceClick={(statusKey, statusLabel) => {
            const card = MATCH_STATUS_CARDS.find((c) => c.key === statusKey)
            if (card) openMatchDetails(title, statusLabel, statsData[card.listKey], idKey)
          }}
        />
      </div>
    </div>
  )

  const setupSteps = [
    { label: 'Header Mapping', done: stats.headerMappingConfigured, path: '/admin/header-mapping' },
    { label: 'Combinations', done: stats.combinationConfigured, path: '/admin/combination' },
    { label: 'Connections', done: stats.connectionConfigured, path: '/admin/connect-combination' },
  ]

  const completedSteps = setupSteps.filter(s => s.done).length

  return (
    <AppShell sidebar={<CompanySidebar />}>
      {/* <PageHeader
        title="Dashboard"
        description="Overview of your EXIM automation system"
      /> */}

      <Spin spinning={loadingMatchStats}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          {renderMatchStats(
            'Invoice matching',
            'Sales invoice match status from Sales data',
            sapInvStats,
            'inv',
          )}
          {renderMatchStats(
            'Shipping bill matching',
            'Shipping bill match status from PDF data',
            pdfSbStats,
            'sbNo',
          )}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div style={{ flex: '1 1 360px', minWidth: 0 }}>
            {renderMatchChart('SAP Invoice matching', sapInvStats, 'inv')}
          </div>
          <div style={{ flex: '1 1 360px', minWidth: 0 }}>
            {renderMatchChart('PDF / Shipping bill matching', pdfSbStats, 'sbNo')}
          </div>
        </div>
      </Spin>

      {/* Setup Checklist */}
      <div
        style={{
          background: 'var(--exim-surface)',
          border: '1px solid var(--exim-border-light)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          marginBottom: 24,
          boxShadow: 'var(--shadow-xs)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--exim-text-primary)' }}>
              System Setup
            </div>
            <Text style={{ color: 'var(--exim-text-secondary)', fontSize: 13 }}>
              Complete these steps to start processing
            </Text>
          </div>
          <div style={{
            fontSize: 13,
            fontWeight: 600,
            color: completedSteps === setupSteps.length ? 'var(--exim-success)' : 'var(--exim-primary)',
            background: completedSteps === setupSteps.length ? 'var(--exim-success-light)' : 'var(--exim-primary-50)',
            padding: '4px 12px',
            borderRadius: 'var(--radius-sm)',
          }}>
            {completedSteps === setupSteps.length ? 'Complete' : `${completedSteps} of ${setupSteps.length}`}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{
          height: 6,
          background: 'var(--exim-gray-100)',
          borderRadius: 3,
          marginBottom: 20,
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${(completedSteps / setupSteps.length) * 100}%`,
            background: completedSteps === setupSteps.length
              ? 'var(--exim-success)'
              : 'linear-gradient(90deg, var(--exim-primary) 0%, #3B6FFF 100%)',
            borderRadius: 3,
            transition: 'width 0.5s ease',
          }} />
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {setupSteps.map((step, i) => (
            <div
              key={i}
              onClick={() => !step.done && navigate(step.path)}
              style={{
                flex: '1 1 200px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${step.done ? 'var(--exim-success)' : 'var(--exim-border)'}`,
                background: step.done ? 'var(--exim-success-light)' : 'var(--exim-surface)',
                cursor: step.done ? 'default' : 'pointer',
                transition: 'all var(--transition-fast)',
              }}
            >
              {step.done
                ? <CheckCircleOutlined style={{ fontSize: 18, color: 'var(--exim-success)' }} />
                : <ClockCircleOutlined style={{ fontSize: 18, color: 'var(--exim-gray-400)' }} />
              }
              <div>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: step.done ? 'var(--exim-success)' : 'var(--exim-text-primary)',
                }}>
                  {step.label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--exim-text-muted)' }}>
                  {step.done ? 'Configured' : 'Not configured'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions Grid */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--exim-text-primary)', marginBottom: 16 }}>
          Quick Actions
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
        }}>
          {QUICK_ACTIONS.map((action) => (
            <div
              key={action.key}
              onClick={() => navigate(action.path)}
              style={{
                background: 'var(--exim-surface)',
                border: '1px solid var(--exim-border-light)',
                borderRadius: 'var(--radius-lg)',
                padding: 20,
                cursor: 'pointer',
                transition: 'all var(--transition-base)',
                boxShadow: 'var(--shadow-xs)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 16,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = 'var(--shadow-md)'
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.borderColor = 'var(--exim-primary-100)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = 'var(--shadow-xs)'
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.borderColor = 'var(--exim-border-light)'
              }}
            >
              <div style={{
                width: 44,
                height: 44,
                borderRadius: 'var(--radius-md)',
                background: action.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                {action.icon}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--exim-text-primary)',
                  marginBottom: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  {action.title}
                  <ArrowRightOutlined style={{ fontSize: 12, color: 'var(--exim-gray-400)' }} />
                </div>
                <div style={{
                  fontSize: 13,
                  color: 'var(--exim-text-secondary)',
                  lineHeight: 1.4,
                }}>
                  {action.description}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Modal
        title={detailModal.title}
        open={detailModal.open}
        onCancel={() => setDetailModal({ open: false, title: '', items: [] })}
        footer={null}
        width={520}
      >
        {detailModal.items.length ? (
          <Space size={[8, 8]} wrap>
            {detailModal.items.map((item) => (
              <Tag key={item} style={{ margin: 0, fontSize: 13, padding: '4px 10px' }}>
                {item}
              </Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">No records in this category.</Text>
        )}
      </Modal>
    </AppShell>
  )
}
