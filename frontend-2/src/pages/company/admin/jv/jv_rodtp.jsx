import { DownloadOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Modal, Space, Table, Tag, Typography, message, ConfigProvider, Card } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'
import ProDataTable from '../../../../components/shared/ProDataTable.jsx'

const { Title, Text } = Typography

const SAP_PENDING_LABEL = 'SAP upload pending'

function normalizeDates(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.rows)) return payload.rows
    if (Array.isArray(payload.data)) return payload.data
    if (Array.isArray(payload.dates)) return payload.dates
    if (payload.data && typeof payload.data === 'object') {
      if (Array.isArray(payload.data.rows)) return payload.data.rows
      if (Array.isArray(payload.data.dates)) return payload.data.dates
      if (Array.isArray(payload.data.items)) return payload.data.items
    }
  }
  return []
}

function normalizeDateRow(d) {
  if (d == null) return null
  if (typeof d === 'string') {
    const v = d.trim()
    return v ? { id: v, dayKey: v } : null
  }
  if (typeof d === 'object') {
    const id = String(d.id ?? d.dayKey ?? d.date ?? '').trim()
    if (!id) return null
    return {
      ...d,
      id,
      dayKey: String(d.dayKey ?? d.date ?? d.id ?? id).trim(),
    }
  }
  const v = String(d).trim()
  return v ? { id: v, dayKey: v } : null
}

function normalizeRowsForMultiDate(payload) {
  if (Array.isArray(payload)) {
    const hasNestedRows = payload.some((entry) => Array.isArray(entry?.rows))
    if (hasNestedRows) {
      const flattened = []
      for (const entry of payload) {
        const nested = Array.isArray(entry?.rows) ? entry.rows : []
        if (!nested.length) continue
        const dayKey = entry?.dayKey ?? entry?.id ?? entry?.date ?? ''
        for (const row of nested) {
          if (!row || typeof row !== 'object') continue
          flattened.push({ ...row, _dayKey: dayKey })
        }
      }
      return flattened
    }
    return payload.filter((r) => r && typeof r === 'object')
  }

  if (!payload || typeof payload !== 'object') return []

  const candidates = [
    payload.rows,
    payload.data,
    payload.items,
    payload.data?.rows,
    payload.data?.items,
    payload.data?.row?.rows,
    payload.row?.rows,
  ]

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue
    const normalized = normalizeRowsForMultiDate(candidate)
    if (normalized.length) return normalized
  }

  const buckets = [
    payload.rowsByDate,
    payload.data?.rowsByDate,
    payload.dataByDate,
    payload.data?.dataByDate,
  ]

  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue
    const merged = []
    for (const [dayKey, v] of Object.entries(bucket)) {
      if (!Array.isArray(v)) continue
      for (const row of v) {
        if (!row || typeof row !== 'object') continue
        merged.push({ ...row, _dayKey: dayKey })
      }
    }
    if (merged.length) return merged
  }

  return []
}

function isBlankJvRow(row) {
  if (!row || typeof row !== 'object') return true
  return Object.entries(row).every(([key, value]) => {
    if (String(key).toLowerCase() === 'inv') return true
    const text = value === null || value === undefined ? '' : String(value).trim()
    return !text
  })
}

function filterBlankJvRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object' && !isBlankJvRow(r))
}

function fileNameFromContentDisposition(header) {
  if (!header) return ''
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
  return plain?.[1]?.trim().replace(/^"|"$/g, '') || ''
}

function formatDateTime(value) {
  if (!value) return '—'
  const d = dayjs(value)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : String(value)
}

function renderSapNo(sapNo) {
  const v = sapNo === null || sapNo === undefined ? '' : String(sapNo).trim()
  if (!v) {
    return <Tag color="warning">{SAP_PENDING_LABEL}</Tag>
  }
  return <Text>{v}</Text>
}

function getColumnsFromRows(rows) {
  const keySet = new Set()
  rows.slice(0, 100).forEach((r) => {
    if (!r || typeof r !== 'object') return
    Object.keys(r).forEach((k) => keySet.add(k))
  })

  const dynamicCols = Array.from(keySet).map((k) => ({
    title: k,
    dataIndex: k,
    key: k,
    width: 180,
    ellipsis: true,
    render: (value) => {
      if (value === null || value === undefined || value === '') return '—'
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value)
        } catch {
          return '[Object]'
        }
      }
      return String(value)
    },
  }))

  return [
    {
      title: 'Index No',
      key: 'index',
      width: 90,
      fixed: 'left',
      render: (_, __, index) => index + 1,
    },
    ...dynamicCols,
  ]
}

export default function CompanyAdminJvRodtpPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [processing, setProcessing] = useState(false)
  const [loadingDates, setLoadingDates] = useState(false)
  const [dateRows, setDateRows] = useState([])
  const [view, setView] = useState('table')
  const [viewModal, setViewModal] = useState({
    loading: false,
    exporting: false,
    dateId: '',
    dayKey: '',
    sapNo: '',
    rows: [],
  })
  
  const [tableRefreshKey, setTableRefreshKey] = useState(0)
  const [modalRefreshKey, setModalRefreshKey] = useState(0)

  useEffect(() => {
    setTableRefreshKey((prev) => prev + 1)
  }, [dateRows])

  useEffect(() => {
    setModalRefreshKey((prev) => prev + 1)
  }, [viewModal.rows])

  const fetchMainTableData = useCallback(async ({ page, limit, search }) => {
    let filtered = dateRows
    if (search) {
      const lowerSearch = search.toLowerCase()
      filtered = filtered.filter((row) =>
        Object.values(row).some((val) => String(val).toLowerCase().includes(lowerSearch))
      )
    }
    const total = filtered.length
    const start = (page - 1) * limit
    const paginated = filtered.slice(start, start + limit)
    return {
      data: paginated,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }, [dateRows])

  const fetchModalTableData = useCallback(async ({ page, limit, search }) => {
    let filtered = viewModal.rows
    if (search) {
      const lowerSearch = search.toLowerCase()
      filtered = filtered.filter((row) =>
        Object.values(row).some((val) => String(val).toLowerCase().includes(lowerSearch))
      )
    }
    const total = filtered.length
    const start = (page - 1) * limit
    const paginated = filtered.slice(start, start + limit)
    return {
      data: paginated,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }, [viewModal.rows])

  const fetchDates = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoadingDates(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/jv/get-jv-rodtp-dates`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load JV RODTP dates (${res.status})`)
      }
      const list = normalizeDates(data).map(normalizeDateRow).filter(Boolean)
      setDateRows(list)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load JV RODTP dates')
      setDateRows([])
    } finally {
      setLoadingDates(false)
    }
  }, [BACKEND_URL])

  const fetchRowsForDate = useCallback(
    async (dateId) => {
      const id = String(dateId || '').trim()
      if (!BACKEND_URL || !id) return []

      const res = await fetch(`${BACKEND_URL}/api/company/admin/jv/get-jv-rodtp-date-wise-data`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load JV RODTP data (${res.status})`)
      }
      return filterBlankJvRows(normalizeRowsForMultiDate(data))
    },
    [BACKEND_URL],
  )

  const downloadExcelForDate = useCallback(
    async (dateId) => {
      const id = String(dateId || '').trim()
      if (!BACKEND_URL || !id) return

      const res = await fetch(`${BACKEND_URL}/api/company/admin/jv/get-jv-rodtp-date-wise-data-into-excel`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.detail || data?.message || `Excel export failed (${res.status})`)
      }

      const blob = await res.blob()
      const filename = fileNameFromContentDisposition(res.headers.get('Content-Disposition')) || `jv-rodtp-${id}.xlsx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    },
    [BACKEND_URL],
  )

  const handleView = useCallback(
    async (record) => {
      const dateId = String(record?.id ?? record?.dayKey ?? '').trim()
      if (!dateId) return

      setView('form')
      setViewModal({
        loading: true,
        exporting: false,
        dateId,
        dayKey: String(record?.dayKey ?? record?.id ?? dateId),
        sapNo: record?.sapNo ?? '',
        rows: [],
      })

      try {
        const rows = await fetchRowsForDate(dateId)
        setViewModal((prev) => ({ ...prev, loading: false, rows }))
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Failed to load JV RODTP rows')
        setViewModal((prev) => ({ ...prev, loading: false, rows: [] }))
      }
    },
    [fetchRowsForDate],
  )

  const handleExportFromModal = useCallback(async () => {
    if (!viewModal.dateId) return
    setViewModal((prev) => ({ ...prev, exporting: true }))
    try {
      await downloadExcelForDate(viewModal.dateId)
      message.success('Excel export started.')
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to export Excel')
    } finally {
      setViewModal((prev) => ({ ...prev, exporting: false }))
    }
  }, [downloadExcelForDate, viewModal.dateId])

  useEffect(() => {
    fetchDates()
  }, [fetchDates])

  const handleProcess = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    setProcessing(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/jv/process-jv-rodtp`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Process JV RODTP failed (${res.status})`)
      }
      message.success(data?.message || 'JV RODTP process started/completed successfully')
      await fetchDates()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to process JV RODTP')
    } finally {
      setProcessing(false)
    }
  }, [BACKEND_URL, fetchDates])

  const detailColumns = useMemo(() => getColumnsFromRows(viewModal.rows), [viewModal.rows])

  const dateTableColumns = useMemo(
    () => [
      {
        title: 'Date',
        dataIndex: 'dayKey',
        key: 'dayKey',
        width: 140,
        render: (_, record) => record?.dayKey ?? record?.id ?? '—',
      },
      {
        title: 'Generated Rows',
        dataIndex: 'generatedRowsCount',
        key: 'generatedRowsCount',
        width: 140,
        render: (value) => (value === null || value === undefined ? '—' : String(value)),
      },
      {
        title: 'Count',
        dataIndex: 'count',
        key: 'count',
        width: 100,
        render: (value) => (value === null || value === undefined ? '—' : String(value)),
      },
      {
        title: 'Created At',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 180,
        render: (value) => formatDateTime(value),
      },
      {
        title: 'SAP No',
        dataIndex: 'sapNo',
        key: 'sapNo',
        width: 180,
        render: (value) => renderSapNo(value),
      },
      {
        title: 'Action',
        key: 'action',
        width: 100,
        fixed: 'right',
        render: (_, record) => (
          <Button type="link" icon={<EyeOutlined />} onClick={() => handleView(record)}>
            View
          </Button>
        ),
      },
    ],
    [handleView],
  )

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <Space direction="vertical" size={16} style={{ width: '100%', minWidth: 0 }}>
        {view === 'form' ? (
          <>
            <PageHeader
              title={`JV RODTP Data — ${viewModal.dayKey || '—'}`}
              description="Detailed rows for the selected date."
              actions={
                <Space>
                  <Button onClick={() => { setView('table'); setViewModal({ loading: false, exporting: false, dateId: '', dayKey: '', sapNo: '', rows: [] }); }} style={{ borderRadius: 6 }}>
                    Back to Dates
                  </Button>
                  <Button type="primary" icon={<DownloadOutlined />} loading={viewModal.exporting} onClick={handleExportFromModal} style={{ borderRadius: 6, boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)' }}>
                    Export Excel
                  </Button>
                </Space>
              }
            />
            <ConfigProvider
              theme={{
                token: { colorPrimary: '#2563eb', borderRadius: 6, colorText: '#1e293b' },
                components: {
                  Table: { headerBg: '#f1f5f9', headerColor: '#334155', headerBorderRadius: 8, borderColor: '#e2e8f0', rowHoverBg: '#f8fafc', cellPaddingBlock: 12 },
                  Button: { primaryColor: '#ffffff', colorPrimary: '#2563eb', colorPrimaryHover: '#1d4ed8', colorPrimaryActive: '#1e40af' },
                }
              }}
            >
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <div style={{ padding: '12px 16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  <Space size="small">
                    <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>Date:</Text>
                    <Tag color="blue" style={{ margin: 0, fontSize: 13, padding: '2px 8px' }}>{viewModal.dayKey || '—'}</Tag>
                  </Space>
                  <Space size="small">
                    <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>SAP No:</Text>
                    {renderSapNo(viewModal.sapNo)}
                  </Space>
                  <Space size="small">
                    <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>Generated Rows:</Text>
                    <Text strong style={{ color: '#0f172a' }}>{viewModal.rows.length}</Text>
                  </Space>
                </div>

                {viewModal.loading ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading detailed records...</div>
                ) : (
                  <div style={{ animation: 'fadeIn 0.3s' }}>
                    <ProDataTable
                      columns={detailColumns}
                      fetchData={fetchModalTableData}
                      refreshKey={modalRefreshKey}
                      rowKey={(r, i) => String(r?.id ?? r?._id ?? r?.ASSIGNMENT ?? `jv-rodtp-detail-${i}`)}
                      globalSearchPlaceholder="Search detailed records..."
                      showSelectionColumn={false}
                    />
                  </div>
                )}
              </Space>
            </ConfigProvider>
          </>
        ) : (
          <>
            <PageHeader
              title="JV RODTP"
              description="Run JV RODTP process and view date-wise generated rows."
              actions={
                <Space>
                  <Button icon={<ReloadOutlined />} onClick={() => fetchDates()} loading={loadingDates} disabled={!BACKEND_URL || loadingDates} style={{ borderRadius: 6 }}>
                    Refresh
                  </Button>
                  <Button type="primary" loading={processing} onClick={handleProcess} disabled={!BACKEND_URL} style={{ borderRadius: 6, boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)' }}>
                    Process JV RODTP
                  </Button>
                </Space>
              }
            />

            <ConfigProvider
              theme={{
                token: { colorPrimary: '#2563eb', borderRadius: 6, colorText: '#1e293b' },
                components: {
                  Table: { headerBg: '#f1f5f9', headerColor: '#334155', headerBorderRadius: 8, borderColor: '#e2e8f0', rowHoverBg: '#f8fafc', cellPaddingBlock: 12 },
                  Button: { primaryColor: '#ffffff', colorPrimary: '#2563eb', colorPrimaryHover: '#1d4ed8', colorPrimaryActive: '#1e40af' },
                }
              }}
            >
              <div style={{ animation: 'fadeIn 0.3s' }}>
                <ProDataTable
                  columns={dateTableColumns}
                  fetchData={fetchMainTableData}
                  refreshKey={tableRefreshKey}
                  rowKey={(r) => String(r?.id ?? r?.dayKey ?? r?.createdAt ?? Math.random())}
                  globalSearchPlaceholder="Search dates or SAP numbers..."
                  showSelectionColumn={false}
                />
              </div>
            </ConfigProvider>
          </>
        )}
      </Space>
    </AppShell>
  )
}
