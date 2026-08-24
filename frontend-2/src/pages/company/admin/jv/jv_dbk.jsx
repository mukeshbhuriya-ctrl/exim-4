import { DownloadOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Modal, Space, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'

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

export default function CompanyAdminJvDbkPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [processing, setProcessing] = useState(false)
  const [loadingDates, setLoadingDates] = useState(false)
  const [dateRows, setDateRows] = useState([])
  const [viewModal, setViewModal] = useState({
    open: false,
    loading: false,
    exporting: false,
    dateId: '',
    dayKey: '',
    sapNo: '',
    rows: [],
  })

  const fetchDates = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoadingDates(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/jv/get-jv-dbk-dates`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load JV DBK dates (${res.status})`)
      }
      const list = normalizeDates(data).map(normalizeDateRow).filter(Boolean)
      setDateRows(list)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load JV DBK dates')
      setDateRows([])
    } finally {
      setLoadingDates(false)
    }
  }, [BACKEND_URL])

  const fetchRowsForDate = useCallback(
    async (dateId) => {
      const id = String(dateId || '').trim()
      if (!BACKEND_URL || !id) return []

      const res = await fetch(`${BACKEND_URL}/api/company/admin/jv/get-jv-dbk-date-wise-data`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load JV DBK data (${res.status})`)
      }
      return filterBlankJvRows(normalizeRowsForMultiDate(data))
    },
    [BACKEND_URL],
  )

  const downloadExcelForDate = useCallback(
    async (dateId) => {
      const id = String(dateId || '').trim()
      if (!BACKEND_URL || !id) return

      const res = await fetch(`${BACKEND_URL}/api/company/admin/jv/get-jv-dbk-date-wise-data-into-excel`, {
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
      const filename = fileNameFromContentDisposition(res.headers.get('Content-Disposition')) || `jv-dbk-${id}.xlsx`
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

      setViewModal({
        open: true,
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
        message.error(err instanceof Error ? err.message : 'Failed to load JV DBK rows')
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
      const res = await fetch(`${BACKEND_URL}/api/company/admin/jv/process-jv-dbk`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Process JV DBK failed (${res.status})`)
      }
      message.success(data?.message || 'JV DBK process started/completed successfully')
      await fetchDates()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to process JV DBK')
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
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            JV DBK
          </Title>
          <Text type="secondary">Run JV DBK process and view date-wise generated rows.</Text>
        </div>

        <Space wrap>
          <Button type="primary" loading={processing} onClick={handleProcess} disabled={!BACKEND_URL}>
            Process JV DBK
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => fetchDates()}
            loading={loadingDates}
            disabled={!BACKEND_URL || loadingDates}
          >
            Refresh
          </Button>
        </Space>

        <Table
          rowKey={(r) => String(r?.id ?? r?.dayKey ?? r?.createdAt)}
          columns={dateTableColumns}
          dataSource={dateRows}
          loading={loadingDates}
          pagination={{ pageSize: 25, showSizeChanger: true }}
          scroll={{ x: 'max-content' }}
          size="small"
          locale={{ emptyText: 'No JV DBK dates found.' }}
        />
      </Space>

      <Modal
        title={`JV DBK — ${viewModal.dayKey || '—'}`}
        open={viewModal.open}
        onCancel={() =>
          setViewModal({ open: false, loading: false, exporting: false, dateId: '', dayKey: '', sapNo: '', rows: [] })
        }
        width="92%"
        style={{ top: 24 }}
        footer={[
          <Button key="export" icon={<DownloadOutlined />} loading={viewModal.exporting} onClick={handleExportFromModal}>
            Export Excel
          </Button>,
          <Button
            key="close"
            onClick={() =>
              setViewModal({ open: false, loading: false, exporting: false, dateId: '', dayKey: '', sapNo: '', rows: [] })
            }
          >
            Close
          </Button>,
        ]}
        destroyOnClose
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space wrap>
            <Text type="secondary">Date:</Text>
            <Text strong>{viewModal.dayKey || '—'}</Text>
            <Text type="secondary">SAP No:</Text>
            {renderSapNo(viewModal.sapNo)}
            <Text type="secondary">Rows:</Text>
            <Text strong>{viewModal.rows.length}</Text>
          </Space>
          <Table
            rowKey={(r, i) => String(r?.id ?? r?._id ?? r?.ASSIGNMENT ?? `jv-dbk-detail-${i}`)}
            columns={detailColumns}
            dataSource={viewModal.rows}
            loading={viewModal.loading}
            pagination={{ pageSize: 25, showSizeChanger: true }}
            scroll={{ x: 'max-content' }}
            size="small"
            locale={{ emptyText: viewModal.loading ? 'Loading…' : 'No rows found for this date.' }}
          />
        </Space>
      </Modal>
    </AppShell>
  )
}
