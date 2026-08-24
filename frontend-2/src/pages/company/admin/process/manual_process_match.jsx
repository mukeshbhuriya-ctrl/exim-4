import { ArrowRightOutlined, CheckCircleOutlined, LinkOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'

const { Title, Text } = Typography

const PROCESS_BASE = '/api/company/admin/process'

const DEFAULT_SALES_DISPLAY_KEYS = ['inv', 'qty1', 'qty2', 'amount']
const DEFAULT_PDF_DISPLAY_KEYS = ['inv', 'qty', 'amount']
const PDF_DESCRIPTION_FIELD = 'id.4.DESCRIPTION'

const ALL_ROW_STATUS_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'exception', label: 'Exception' },
  { value: 'ignored', label: 'Ignored' },
]

const INVOICE_FILTER_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'exception', label: 'Exception' },
  { value: 'ignored', label: 'Ignored' },
]

function normalizeRowStatus(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'exception' || raw === 'ignored' || raw === 'matched') return raw
  return 'available'
}

function isClosedRowStatus(value) {
  const status = normalizeRowStatus(value)
  return status === 'exception' || status === 'ignored'
}

function collectExtraDataKeys(rows, displayKeys, excludeKeys = []) {
  const reserved = new Set([...displayKeys, 'description', ...excludeKeys.filter(Boolean)])
  const keys = new Set()
  for (const row of rows) {
    const data = row?.data && typeof row.data === 'object' ? row.data : {}
    for (const key of Object.keys(data)) {
      if (!key || reserved.has(key) || key.startsWith('_')) continue
      keys.add(key)
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b))
}

function flattenRowForTable(row, rowNo, displayKeys, extraKeys = []) {
  const displayValues =
    row?.displayValues && typeof row.displayValues === 'object' ? row.displayValues : {}
  const data = row?.data && typeof row.data === 'object' ? row.data : {}
  const isMatched = Boolean(row.isMatched)
  const rowStatus = isMatched ? 'matched' : normalizeRowStatus(row.rowStatus)
  const flat = {
    key: row.id || row.rowId || row.pdfRowId,
    rowNo,
    rowId: row.rowId || row.id,
    pdfRowId: row.pdfRowId || row.id,
    description: row.description ?? '',
    isMatched,
    rowStatus,
  }
  for (const key of displayKeys) {
    flat[key] = displayValues[key] ?? row[key] ?? ''
  }
  for (const key of extraKeys) {
    flat[key] = data[key] ?? ''
  }
  return flat
}

function buildDetailItems(row, displayKeys) {
  if (!row) return []
  const items = displayKeys
    .map((key) => {
      const value = row[key]
      if (value == null || value === '') return null
      return { key, label: key, value: String(value) }
    })
    .filter(Boolean)
  if (row.description) {
    items.push({ key: 'description', label: 'description', value: String(row.description) })
  }
  return items
}

function LinkedPairCard({ index, pair, salesDisplayKeys, pdfDisplayKeys, salesRow, pdfRow, onUnlink }) {
  const salesItems = buildDetailItems(salesRow, salesDisplayKeys)
  const pdfItems = buildDetailItems(pdfRow, pdfDisplayKeys)

  const renderValue = (item) =>
    item.key === 'description' ? (
      <Tooltip title={item.value}>
        <span
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {item.value}
        </span>
      </Tooltip>
    ) : (
      item.value
    )

  const renderSideCard = (title, tagColor, rowNo, items, accentColor, bgColor) => (
    <Card
      size="small"
      title={
        <Space size={8}>
          <Tag color={tagColor} style={{ margin: 0 }}>
            {title} #{rowNo}
          </Tag>
        </Space>
      }
      styles={{
        header: { minHeight: 40, padding: '0 14px', background: bgColor, borderBottom: `1px solid ${accentColor}` },
        body: { padding: '12px 14px' },
      }}
      style={{
        flex: 1,
        minWidth: 0,
        borderColor: accentColor,
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      }}
    >
      <Descriptions
        size="small"
        column={1}
        colon={false}
        styles={{ label: { width: 92, color: '#8c8c8c', fontSize: 12, fontWeight: 500 } }}
      >
        {items.length ? (
          items.map((item) => (
            <Descriptions.Item
              key={item.key}
              label={item.label}
              contentStyle={{ fontSize: 13, wordBreak: 'break-word' }}
            >
              {renderValue(item)}
            </Descriptions.Item>
          ))
        ) : (
          <Descriptions.Item label="—">No data</Descriptions.Item>
        )}
      </Descriptions>
    </Card>
  )

  return (
    <div
      style={{
        border: '1px solid #e8e8e8',
        borderRadius: 10,
        padding: 12,
        background: '#fafafa',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <Text strong style={{ fontSize: 14 }}>
          Pair #{index + 1}
        </Text>
        <Button size="small" danger onClick={onUnlink}>
          Unlink
        </Button>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 12,
        }}
      >
        {renderSideCard('Sales', 'blue', pair.salesRowNo, salesItems, '#91caff', '#f0f7ff')}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            flexShrink: 0,
            color: '#8c8c8c',
            fontSize: 16,
          }}
        >
          <ArrowRightOutlined />
        </div>
        {renderSideCard('PDF', 'purple', pair.pdfRowNo, pdfItems, '#d3adf7', '#f9f0ff')}
      </div>
    </div>
  )
}

function buildTableColumns(displayKeys, extraKeys = []) {
  const keys = ['rowNo', ...displayKeys, 'description', ...extraKeys]
  return keys.map((k) => {
    if (k === 'rowNo') {
      return {
        title: '#',
        dataIndex: 'rowNo',
        key: 'rowNo',
        width: 52,
        fixed: 'left',
        render: (v) => <Text strong>{v}</Text>,
      }
    }
    return {
      title: k,
      dataIndex: k,
      key: k,
      ellipsis: true,
      width: k === 'inv' ? 140 : undefined,
      render: (v) => (v == null || v === '' ? '—' : String(v)),
    }
  })
}

function rowSummary(row, displayKeys) {
  if (!row) return '—'
  const parts = displayKeys
    .map((key) => {
      const value = row[key]
      if (value == null || value === '') return null
      return `${key}: ${value}`
    })
    .filter(Boolean)
  return parts.length ? parts.join(' · ') : `Row #${row.rowNo}`
}

export default function CompanyAdminManualProcessMatchPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [invoices, setInvoices] = useState([])
  const [invoiceFilter, setInvoiceFilter] = useState('available')
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [salesRows, setSalesRows] = useState([])
  const [pdfRows, setPdfRows] = useState([])
  const [selectedSalesKey, setSelectedSalesKey] = useState(null)
  const [selectedPdfKey, setSelectedPdfKey] = useState(null)
  const [pendingPairs, setPendingPairs] = useState([])
  const [salesDisplayKeys, setSalesDisplayKeys] = useState(DEFAULT_SALES_DISPLAY_KEYS)
  const [pdfDisplayKeys, setPdfDisplayKeys] = useState(DEFAULT_PDF_DISPLAY_KEYS)
  const [salesDescriptionColumn, setSalesDescriptionColumn] = useState('')
  const [matchedSalesCount, setMatchedSalesCount] = useState(0)
  const [matchedPdfCount, setMatchedPdfCount] = useState(0)
  const [loadingInvoices, setLoadingInvoices] = useState(false)
  const [loadingRows, setLoadingRows] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submittingStatus, setSubmittingStatus] = useState(false)
  /** Draft status changes keyed by `${side}:${rowId}` — submitted via button */
  const [pendingStatusUpdates, setPendingStatusUpdates] = useState({})
  const [mergeSelectedKeys, setMergeSelectedKeys] = useState([])
  const [merging, setMerging] = useState(false)

  const pairedSalesIds = useMemo(
    () => new Set(pendingPairs.map((p) => p.salesRowId)),
    [pendingPairs]
  )
  const pairedPdfIds = useMemo(
    () => new Set(pendingPairs.map((p) => p.pdfRowId)),
    [pendingPairs]
  )

  const alreadyMatchedSalesIds = useMemo(
    () => new Set(salesRows.filter((row) => row.isMatched).map((row) => row.id || row.rowId)),
    [salesRows]
  )
  const alreadyMatchedPdfIds = useMemo(
    () => new Set(pdfRows.filter((row) => row.isMatched).map((row) => row.id || row.pdfRowId)),
    [pdfRows]
  )

  const closedSalesIds = useMemo(
    () =>
      new Set(
        salesRows
          .filter((row) => !row.isMatched && isClosedRowStatus(row.rowStatus))
          .map((row) => row.id || row.rowId)
      ),
    [salesRows]
  )
  const closedPdfIds = useMemo(
    () =>
      new Set(
        pdfRows
          .filter((row) => !row.isMatched && isClosedRowStatus(row.rowStatus))
          .map((row) => row.id || row.pdfRowId)
      ),
    [pdfRows]
  )

  const draftStatusSalesIds = useMemo(
    () =>
      new Set(
        Object.values(pendingStatusUpdates)
          .filter((u) => u.side === 'sales')
          .map((u) => u.rowId)
      ),
    [pendingStatusUpdates]
  )
  const draftStatusPdfIds = useMemo(
    () =>
      new Set(
        Object.values(pendingStatusUpdates)
          .filter((u) => u.side === 'pdf')
          .map((u) => u.rowId)
      ),
    [pendingStatusUpdates]
  )

  const lockedSalesIds = useMemo(
    () =>
      new Set([
        ...pairedSalesIds,
        ...alreadyMatchedSalesIds,
        ...closedSalesIds,
        ...draftStatusSalesIds,
      ]),
    [pairedSalesIds, alreadyMatchedSalesIds, closedSalesIds, draftStatusSalesIds]
  )
  const lockedPdfIds = useMemo(
    () =>
      new Set([
        ...pairedPdfIds,
        ...alreadyMatchedPdfIds,
        ...closedPdfIds,
        ...draftStatusPdfIds,
      ]),
    [pairedPdfIds, alreadyMatchedPdfIds, closedPdfIds, draftStatusPdfIds]
  )

  const salesExtraKeys = useMemo(
    () => collectExtraDataKeys(salesRows, salesDisplayKeys, [salesDescriptionColumn]),
    [salesRows, salesDisplayKeys, salesDescriptionColumn]
  )
  const pdfExtraKeys = useMemo(
    () => collectExtraDataKeys(pdfRows, pdfDisplayKeys, [PDF_DESCRIPTION_FIELD]),
    [pdfRows, pdfDisplayKeys]
  )

  const salesTableRows = useMemo(
    () => salesRows.map((row, idx) => flattenRowForTable(row, idx + 1, salesDisplayKeys, salesExtraKeys)),
    [salesRows, salesDisplayKeys, salesExtraKeys]
  )
  const pdfTableRows = useMemo(
    () => pdfRows.map((row, idx) => flattenRowForTable(row, idx + 1, pdfDisplayKeys, pdfExtraKeys)),
    [pdfRows, pdfDisplayKeys, pdfExtraKeys]
  )

  const salesByKey = useMemo(
    () => new Map(salesTableRows.map((r) => [r.key, r])),
    [salesTableRows]
  )
  const pdfByKey = useMemo(
    () => new Map(pdfTableRows.map((r) => [r.key, r])),
    [pdfTableRows]
  )

  const selectedSalesRow = selectedSalesKey ? salesByKey.get(selectedSalesKey) : null
  const selectedPdfRow = selectedPdfKey ? pdfByKey.get(selectedPdfKey) : null

  const salesColumns = useMemo(
    () => buildTableColumns(salesDisplayKeys, salesExtraKeys),
    [salesDisplayKeys, salesExtraKeys]
  )
  const pdfColumns = useMemo(
    () => buildTableColumns(pdfDisplayKeys, pdfExtraKeys),
    [pdfDisplayKeys, pdfExtraKeys]
  )

  const loadInvoices = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoadingInvoices(true)
    try {
      const qs = new URLSearchParams()
      if (invoiceFilter && invoiceFilter !== 'available') {
        qs.set('status', invoiceFilter)
      }
      const suffix = qs.toString() ? `?${qs}` : ''
      const res = await fetch(
        `${BACKEND_URL}${PROCESS_BASE}/get-unmatched-invoices${suffix}`,
        { credentials: 'include' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Failed to load invoices (${res.status})`)
      }
      setInvoices(Array.isArray(data.invoices) ? data.invoices : [])
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load unmatched invoices')
    } finally {
      setLoadingInvoices(false)
    }
  }, [BACKEND_URL, invoiceFilter])

  const loadRowsForInvoice = useCallback(
    async (invoice) => {
      if (!BACKEND_URL || !invoice) return
      setLoadingRows(true)
      setSelectedSalesKey(null)
      setSelectedPdfKey(null)
      setPendingPairs([])
      setPendingStatusUpdates({})
      setMergeSelectedKeys([])
      try {
        const qs = new URLSearchParams({ invoice: String(invoice) })
        const res = await fetch(
          `${BACKEND_URL}${PROCESS_BASE}/get-unmatched-rows-by-invoice?${qs}`,
          { credentials: 'include' }
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.message || `Failed to load rows (${res.status})`)
        }
        setSalesRows(Array.isArray(data.salesRows) ? data.salesRows : [])
        setPdfRows(Array.isArray(data.pdfRows) ? data.pdfRows : [])
        const salesKeys = Array.isArray(data.displayColumns?.sales)
          ? data.displayColumns.sales.filter((k) => k !== 'description')
          : DEFAULT_SALES_DISPLAY_KEYS
        const pdfKeys = Array.isArray(data.displayColumns?.pdf)
          ? data.displayColumns.pdf.filter((k) => k !== 'description')
          : DEFAULT_PDF_DISPLAY_KEYS
        setSalesDisplayKeys(salesKeys.length ? salesKeys : DEFAULT_SALES_DISPLAY_KEYS)
        setPdfDisplayKeys(pdfKeys.length ? pdfKeys : DEFAULT_PDF_DISPLAY_KEYS)
        setSalesDescriptionColumn(
          typeof data.salesDescriptionColumn === 'string' ? data.salesDescriptionColumn : ''
        )
        setMatchedSalesCount(
          typeof data.matchedSalesCount === 'number'
            ? data.matchedSalesCount
            : (Array.isArray(data.salesRows) ? data.salesRows : []).filter((r) => r.isMatched).length
        )
        setMatchedPdfCount(
          typeof data.matchedPdfCount === 'number'
            ? data.matchedPdfCount
            : (Array.isArray(data.pdfRows) ? data.pdfRows : []).filter((r) => r.isMatched).length
        )
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Failed to load rows for invoice')
        setSalesRows([])
        setPdfRows([])
      } finally {
        setLoadingRows(false)
      }
    },
    [BACKEND_URL]
  )

  useEffect(() => {
    loadInvoices()
  }, [loadInvoices])

  useEffect(() => {
    if (selectedInvoice) {
      loadRowsForInvoice(selectedInvoice)
    } else {
      setSalesRows([])
      setPdfRows([])
      setSalesDescriptionColumn('')
      setMatchedSalesCount(0)
      setMatchedPdfCount(0)
      setSelectedSalesKey(null)
      setSelectedPdfKey(null)
      setPendingPairs([])
      setPendingStatusUpdates({})
      setMergeSelectedKeys([])
    }
  }, [selectedInvoice, loadRowsForInvoice])

  const addPair = useCallback(
    (salesKey, pdfKey) => {
      if (!salesKey || !pdfKey) return false
      if (pairedSalesIds.has(salesKey)) {
        message.warning('This sales row is already linked.')
        return false
      }
      if (pairedPdfIds.has(pdfKey)) {
        message.warning('This PDF row is already linked.')
        return false
      }
      if (alreadyMatchedSalesIds.has(salesKey)) {
        message.warning('This sales row is already matched.')
        return false
      }
      if (alreadyMatchedPdfIds.has(pdfKey)) {
        message.warning('This PDF row is already matched.')
        return false
      }
      if (closedSalesIds.has(salesKey)) {
        message.warning('This sales row is Exception/Ignored and cannot be linked.')
        return false
      }
      if (closedPdfIds.has(pdfKey)) {
        message.warning('This PDF row is Exception/Ignored and cannot be linked.')
        return false
      }

      const salesRow = salesByKey.get(salesKey)
      const pdfRow = pdfByKey.get(pdfKey)

      setPendingPairs((prev) => [
        ...prev,
        {
          salesRowId: salesKey,
          pdfRowId: pdfKey,
          salesRowNo: salesRow?.rowNo,
          pdfRowNo: pdfRow?.rowNo,
          salesSummary: rowSummary(salesRow, salesDisplayKeys),
          pdfSummary: rowSummary(pdfRow, pdfDisplayKeys),
        },
      ])
      setSelectedSalesKey(null)
      setSelectedPdfKey(null)
      message.success(`Linked sales #${salesRow?.rowNo} → PDF #${pdfRow?.rowNo}`)
      return true
    },
    [
      pairedSalesIds,
      pairedPdfIds,
      alreadyMatchedSalesIds,
      alreadyMatchedPdfIds,
      closedSalesIds,
      closedPdfIds,
      salesByKey,
      pdfByKey,
      salesDisplayKeys,
      pdfDisplayKeys,
    ]
  )

  const selectSalesRow = useCallback(
    (key) => {
      if (!key || lockedSalesIds.has(key)) return
      if (selectedPdfKey && !lockedPdfIds.has(selectedPdfKey)) {
        addPair(key, selectedPdfKey)
        return
      }
      setSelectedSalesKey(key)
    },
    [lockedSalesIds, lockedPdfIds, selectedPdfKey, addPair]
  )

  const selectPdfRow = useCallback(
    (key) => {
      if (!key || lockedPdfIds.has(key)) return
      if (selectedSalesKey && !lockedSalesIds.has(selectedSalesKey)) {
        addPair(selectedSalesKey, key)
        return
      }
      setSelectedPdfKey(key)
    },
    [lockedPdfIds, lockedSalesIds, selectedSalesKey, addPair]
  )

  const linkSelectedPair = () => {
    if (!selectedSalesKey || !selectedPdfKey) {
      message.warning('Pick one sales row and one PDF row to link.')
      return
    }
    addPair(selectedSalesKey, selectedPdfKey)
  }

  const removePair = (index) => {
    setPendingPairs((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSaveMatches = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!pendingPairs.length) {
      message.warning('Link at least one sales/PDF pair before saving.')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`${BACKEND_URL}${PROCESS_BASE}/manual-match-rows-by-invoice`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice: selectedInvoice || undefined,
          matches: pendingPairs.map(({ salesRowId, pdfRowId }) => ({ salesRowId, pdfRowId })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Save failed (${res.status})`)
      }

      message.success(data?.message || `Saved ${data.matchesSaved ?? pendingPairs.length} match(es).`)
      if (Array.isArray(data.errors) && data.errors.length) {
        message.warning(`${data.errors.length} pair(s) were skipped.`)
        console.warn('Manual match partial errors:', data.errors)
      }

      setPendingPairs([])
      await loadInvoices()
      if (selectedInvoice) {
        await loadRowsForInvoice(selectedInvoice)
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save manual matches')
    } finally {
      setSaving(false)
    }
  }

  const statusDraftKey = (side, rowKey) => `${side}:${rowKey}`

  const setDraftRowStatus = useCallback((side, rowKey, status) => {
    const key = statusDraftKey(side, rowKey)
    setPendingStatusUpdates((prev) => {
      if (!status) {
        if (!(key in prev)) return prev
        const next = { ...prev }
        delete next[key]
        return next
      }
      return {
        ...prev,
        [key]: { side, rowId: rowKey, status },
      }
    })
  }, [])

  const handleSubmitStatusUpdates = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }

    const updates = Object.values(pendingStatusUpdates)
    if (!updates.length) {
      message.warning('Select Exception or Ignored on at least one Available row first.')
      return
    }

    setSubmittingStatus(true)
    const errors = []
    let saved = 0

    try {
      for (const item of updates) {
        try {
          const res = await fetch(`${BACKEND_URL}${PROCESS_BASE}/update-row-status`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              side: item.side,
              rowId: item.rowId,
              status: item.status,
            }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            throw new Error(data?.message || `Status update failed (${res.status})`)
          }
          saved += 1

          setPendingPairs((prev) =>
            prev.filter((p) =>
              item.side === 'sales' ? p.salesRowId !== item.rowId : p.pdfRowId !== item.rowId
            )
          )
          if (item.side === 'sales' && selectedSalesKey === item.rowId) {
            setSelectedSalesKey(null)
          }
          if (item.side === 'pdf' && selectedPdfKey === item.rowId) {
            setSelectedPdfKey(null)
          }

          if (item.side === 'sales') {
            setSalesRows((prev) =>
              prev.map((row) => {
                const id = row.id || row.rowId
                return id === item.rowId
                  ? { ...row, rowStatus: item.status, isMatched: false }
                  : row
              })
            )
          } else {
            setPdfRows((prev) =>
              prev.map((row) => {
                const id = row.id || row.pdfRowId
                return id === item.rowId
                  ? { ...row, rowStatus: item.status, isMatched: false }
                  : row
              })
            )
          }
        } catch (err) {
          errors.push({
            ...item,
            message: err instanceof Error ? err.message : 'Failed',
          })
        }
      }

      if (saved) {
        message.success(`Updated status for ${saved} row(s).`)
      }
      if (errors.length) {
        message.warning(`${errors.length} status update(s) failed.`)
        console.warn('Status update errors:', errors)
      }

      // Keep only failed drafts so user can retry
      if (errors.length) {
        const failedMap = {}
        for (const err of errors) {
          failedMap[statusDraftKey(err.side, err.rowId)] = {
            side: err.side,
            rowId: err.rowId,
            status: err.status,
          }
        }
        setPendingStatusUpdates(failedMap)
      } else {
        setPendingStatusUpdates({})
      }

      await loadInvoices()
    } finally {
      setSubmittingStatus(false)
    }
  }

  const handleMergeRows = async () => {
    if (mergeSelectedKeys.length !== 2) {
      message.warning('Select exactly 2 sales rows to merge.')
      return
    }
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    setMerging(true)
    try {
      const [rowId1, rowId2] = mergeSelectedKeys
      const res = await fetch(`${BACKEND_URL}${PROCESS_BASE}/merge-rows`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId1, rowId2 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Merge failed (${res.status})`)
      }
      message.success(data?.message || 'Rows merged successfully.')
      setMergeSelectedKeys([])
      if (selectedInvoice) await loadRowsForInvoice(selectedInvoice)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to merge rows')
    } finally {
      setMerging(false)
    }
  }

  const renderStatusCell = useCallback(
    (side, record) => {
      if (record.isMatched || record.rowStatus === 'matched') {
        return (
          <Tag icon={<CheckCircleOutlined />} color="success">
            Matched
          </Tag>
        )
      }

      const committed = normalizeRowStatus(record.rowStatus)
      const draft = pendingStatusUpdates[statusDraftKey(side, record.key)]

      // A pending (unsaved) status change takes visual priority.
      if (draft && draft.status !== committed) {
        if (draft.status === 'exception') {
          return (
            <Tag icon={<StopOutlined />} color="warning">
              Exception (pending)
            </Tag>
          )
        }
        if (draft.status === 'ignored') {
          return <Tag color="warning">Ignored (pending)</Tag>
        }
        return <Tag color="warning">Available (pending)</Tag>
      }

      if (committed === 'exception') {
        return (
          <Tag icon={<StopOutlined />} color="error">
            Exception
          </Tag>
        )
      }
      if (committed === 'ignored') {
        return <Tag color="default">Ignored</Tag>
      }

      const pairIdx = pendingPairs.findIndex((p) =>
        side === 'sales' ? p.salesRowId === record.key : p.pdfRowId === record.key
      )
      if (pairIdx >= 0) return <Tag color="processing">Linked #{pairIdx + 1}</Tag>
      if (side === 'sales' && record.key === selectedSalesKey) {
        return <Tag color="blue">Selected</Tag>
      }
      if (side === 'pdf' && record.key === selectedPdfKey) {
        return <Tag color="purple">Selected</Tag>
      }
      return <Tag>Available</Tag>
    },
    [pendingPairs, pendingStatusUpdates, selectedSalesKey, selectedPdfKey]
  )

  const renderUpdateStatusCell = useCallback(
    (side, record) => {
      // Matched rows: no update option
      if (record.isMatched || record.rowStatus === 'matched') return null

      // Linked (pending pair) rows should be unlinked before changing status.
      const isLinked = pendingPairs.some((p) =>
        side === 'sales' ? p.salesRowId === record.key : p.pdfRowId === record.key
      )
      if (isLinked) return null

      const committed = normalizeRowStatus(record.rowStatus)
      const draftKey = statusDraftKey(side, record.key)
      const draftStatus = pendingStatusUpdates[draftKey]?.status

      // Offer every status except the one currently committed:
      // Available rows -> Exception / Ignored
      // Exception/Ignored rows -> Available (+ the other closed status)
      const options = ALL_ROW_STATUS_OPTIONS.filter((o) => o.value !== committed)

      return (
        <Select
          size="small"
          allowClear
          placeholder={committed === 'available' ? 'Set status' : 'Change'}
          style={{ width: 130 }}
          options={options}
          value={draftStatus || undefined}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(value) => setDraftRowStatus(side, record.key, value || null)}
        />
      )
    },
    [pendingPairs, pendingStatusUpdates, setDraftRowStatus]
  )

  const salesColumnsWithStatus = useMemo(() => {
    const statusCol = {
      title: 'Status',
      key: 'matchStatus',
      width: 150,
      fixed: 'left',
      render: (_, record) => renderStatusCell('sales', record),
    }
    const updateCol = {
      title: 'Update status',
      key: 'updateStatus',
      width: 140,
      fixed: 'left',
      render: (_, record) => renderUpdateStatusCell('sales', record),
    }
    return [statusCol, updateCol, ...salesColumns]
  }, [salesColumns, renderStatusCell, renderUpdateStatusCell])

  const pdfColumnsWithStatus = useMemo(() => {
    const statusCol = {
      title: 'Status',
      key: 'matchStatus',
      width: 150,
      fixed: 'left',
      render: (_, record) => renderStatusCell('pdf', record),
    }
    const updateCol = {
      title: 'Update status',
      key: 'updateStatus',
      width: 140,
      fixed: 'left',
      render: (_, record) => renderUpdateStatusCell('pdf', record),
    }
    return [statusCol, updateCol, ...pdfColumns]
  }, [pdfColumns, renderStatusCell, renderUpdateStatusCell])

  const salesRowSelection = {
    type: 'radio',
    selectedRowKeys: selectedSalesKey ? [selectedSalesKey] : [],
    onChange: (keys) => selectSalesRow(keys[0] ?? null),
    getCheckboxProps: (record) => ({
      disabled: lockedSalesIds.has(record.key),
    }),
  }

  const pdfRowSelection = {
    type: 'radio',
    selectedRowKeys: selectedPdfKey ? [selectedPdfKey] : [],
    onChange: (keys) => selectPdfRow(keys[0] ?? null),
    getCheckboxProps: (record) => ({
      disabled: lockedPdfIds.has(record.key),
    }),
  }

  const pendingStatusCount = Object.keys(pendingStatusUpdates).length

  const availableSalesCount = salesTableRows.filter(
    (row) => !row.isMatched && !isClosedRowStatus(row.rowStatus) && !pairedSalesIds.has(row.key)
  ).length
  const availablePdfCount = pdfTableRows.filter(
    (row) => !row.isMatched && !isClosedRowStatus(row.rowStatus) && !pairedPdfIds.has(row.key)
  ).length
  const exceptionSalesCount = salesTableRows.filter((row) => row.rowStatus === 'exception').length
  const ignoredSalesCount = salesTableRows.filter((row) => row.rowStatus === 'ignored').length
  const exceptionPdfCount = pdfTableRows.filter((row) => row.rowStatus === 'exception').length
  const ignoredPdfCount = pdfTableRows.filter((row) => row.rowStatus === 'ignored').length

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <style>{`
        .manual-match-row-paired td {
          background: #e6f4ff !important;
        }
        .manual-match-row-matched td {
          background: #f6ffed !important;
          color: rgba(0, 0, 0, 0.65);
        }
        .manual-match-row-exception td {
          background: #fff1f0 !important;
          color: rgba(0, 0, 0, 0.65);
        }
        .manual-match-row-ignored td {
          background: #fafafa !important;
          color: rgba(0, 0, 0, 0.45);
        }
        .manual-match-row-active td {
          background: #fff7e6 !important;
        }
      `}</style>

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Manual Process Match
          </Title>
          <Text type="secondary">
            Link 1:1 pairs for unmatched rows. Set rows to Exception/Ignored or back to Available,
            then submit. Matched rows cannot change status.
          </Text>
        </div>

        {!BACKEND_URL ? (
          <Alert type="error" showIcon message="VITE_BACKEND_URL is not configured." />
        ) : null}

        <Card size="small" title="1. Select invoice">
          <Space wrap>
            <Select
              style={{ width: 180 }}
              value={invoiceFilter}
              onChange={(value) => {
                setInvoiceFilter(value)
                setSelectedInvoice(null)
              }}
              options={INVOICE_FILTER_OPTIONS}
            />
            <Select
              showSearch
              allowClear
              placeholder="Invoice number"
              style={{ minWidth: 280 }}
              loading={loadingInvoices}
              value={selectedInvoice}
              onChange={setSelectedInvoice}
              options={invoices.map((inv) => ({ label: inv, value: inv }))}
              filterOption={(input, option) =>
                String(option?.label ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              notFoundContent={loadingInvoices ? 'Loading…' : 'No invoices'}
            />
            <Button icon={<ReloadOutlined />} onClick={loadInvoices} loading={loadingInvoices}>
              Reload invoices
            </Button>
            <Text type="secondary">{invoices.length} invoice(s)</Text>
          </Space>
        </Card>

        {selectedInvoice ? (
          <>
            <Alert
              type="info"
              showIcon
              message={`Invoice: ${selectedInvoice}`}
              description={`${availableSalesCount} sales available · ${availablePdfCount} PDF available · ${matchedSalesCount} sales matched · ${matchedPdfCount} PDF matched · ${exceptionSalesCount + exceptionPdfCount} exception · ${ignoredSalesCount + ignoredPdfCount} ignored · ${pendingStatusCount} status change(s) pending · ${pendingPairs.length} new pair(s) pending save`}
            />

            <Card
              size="small"
              title="Status updates"
              extra={
                <Space>
                  <Button
                    disabled={!pendingStatusCount}
                    onClick={() => setPendingStatusUpdates({})}
                  >
                    Clear drafts
                  </Button>
                  <Button
                    type="primary"
                    loading={submittingStatus}
                    disabled={!pendingStatusCount}
                    onClick={handleSubmitStatusUpdates}
                  >
                    Submit status updates{pendingStatusCount ? ` (${pendingStatusCount})` : ''}
                  </Button>
                </Space>
              }
            >
              <Text type="secondary">
                Change any unmatched row to Exception, Ignored, or back to Available, then click Submit. Matched rows have no update option.
              </Text>
            </Card>

            <Card
              size="small"
              title="2. Sales rows"
              extra={<Tag color="blue">1:1 · many pairs</Tag>}
              loading={loadingRows}
              styles={{ body: { padding: 0 } }}
              style={{ width: '100%' }}
            >
              <Table
                size="small"
                rowKey="key"
                columns={salesColumnsWithStatus}
                dataSource={salesTableRows}
                pagination={{ pageSize: 8, size: 'small' }}
                scroll={{ x: 'max-content' }}
                rowSelection={salesRowSelection}
                rowClassName={(record) => {
                  if (record.isMatched || record.rowStatus === 'matched') return 'manual-match-row-matched'
                  if (record.rowStatus === 'exception') return 'manual-match-row-exception'
                  if (record.rowStatus === 'ignored') return 'manual-match-row-ignored'
                  if (pairedSalesIds.has(record.key)) return 'manual-match-row-paired'
                  if (record.key === selectedSalesKey) return 'manual-match-row-active'
                  return ''
                }}
                onRow={(record) => ({
                  onClick: () => selectSalesRow(record.key),
                  style: { cursor: lockedSalesIds.has(record.key) ? 'not-allowed' : 'pointer' },
                })}
              />
            </Card>

            <Card
              size="small"
              title="3. PDF rows"
              extra={<Tag color="purple">1:1 · many pairs</Tag>}
              loading={loadingRows}
              styles={{ body: { padding: 0 } }}
              style={{ width: '100%' }}
            >
              <Table
                size="small"
                rowKey="key"
                columns={pdfColumnsWithStatus}
                dataSource={pdfTableRows}
                pagination={{ pageSize: 8, size: 'small' }}
                scroll={{ x: 'max-content' }}
                rowSelection={pdfRowSelection}
                rowClassName={(record) => {
                  if (record.isMatched || record.rowStatus === 'matched') return 'manual-match-row-matched'
                  if (record.rowStatus === 'exception') return 'manual-match-row-exception'
                  if (record.rowStatus === 'ignored') return 'manual-match-row-ignored'
                  if (pairedPdfIds.has(record.key)) return 'manual-match-row-paired'
                  if (record.key === selectedPdfKey) return 'manual-match-row-active'
                  return ''
                }}
                onRow={(record) => ({
                  onClick: () => selectPdfRow(record.key),
                  style: { cursor: lockedPdfIds.has(record.key) ? 'not-allowed' : 'pointer' },
                })}
              />
            </Card>

            <Card
              size="small"
              title="4. Merge sales rows"
              extra={
                <Button
                  type="primary"
                  danger
                  loading={merging}
                  disabled={mergeSelectedKeys.length !== 2}
                  onClick={handleMergeRows}
                >
                  Merge selected ({mergeSelectedKeys.length}/2)
                </Button>
              }
            >
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Text type="secondary">
                  Select exactly 2 available (unmatched) sales rows to merge them. The first selected row is kept; columns with SUM enabled are added together, others take the first row's value.
                </Text>
                <Table
                  size="small"
                  rowKey="key"
                  columns={salesColumns}
                  dataSource={salesTableRows.filter(
                    (r) => !r.isMatched && r.rowStatus !== 'exception' && r.rowStatus !== 'ignored'
                  )}
                  pagination={{ pageSize: 6, size: 'small' }}
                  scroll={{ x: 'max-content' }}
                  rowSelection={{
                    type: 'checkbox',
                    selectedRowKeys: mergeSelectedKeys,
                    onChange: (keys) => {
                      if (keys.length > 2) {
                        message.warning('Select at most 2 rows to merge.')
                        return
                      }
                      setMergeSelectedKeys(keys)
                    },
                    getCheckboxProps: (record) => ({
                      disabled:
                        mergeSelectedKeys.length >= 2 && !mergeSelectedKeys.includes(record.key),
                    }),
                  }}
                  rowClassName={(record) => {
                    if (mergeSelectedKeys.includes(record.key)) return 'manual-match-row-active'
                    return ''
                  }}
                />
              </Space>
            </Card>

            <Card size="small" title="5. Linked pairs">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {selectedSalesKey && selectedPdfKey ? (
                  <Button
                    type="default"
                    icon={<LinkOutlined />}
                    disabled={loadingRows}
                    onClick={linkSelectedPair}
                  >
                    Link sales #{selectedSalesRow?.rowNo ?? '—'} → PDF #{selectedPdfRow?.rowNo ?? '—'}
                  </Button>
                ) : null}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <Text strong>Ready to save ({pendingPairs.length})</Text>
                  <Button
                    type="primary"
                    icon={<LinkOutlined />}
                    loading={saving}
                    disabled={!pendingPairs.length}
                    onClick={handleSaveMatches}
                  >
                    Save all matches
                  </Button>
                </div>

                {pendingPairs.length ? (
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    {pendingPairs.map((pair, index) => (
                      <LinkedPairCard
                        key={`${pair.salesRowId}-${pair.pdfRowId}`}
                        index={index}
                        pair={pair}
                        salesDisplayKeys={salesDisplayKeys}
                        pdfDisplayKeys={pdfDisplayKeys}
                        salesRow={salesByKey.get(pair.salesRowId)}
                        pdfRow={pdfByKey.get(pair.pdfRowId)}
                        onUnlink={() => removePair(index)}
                      />
                    ))}
                  </Space>
                ) : (
                  <Text type="secondary">
                    Pick a sales row, then a PDF row — pairs link automatically. Repeat, then save.
                  </Text>
                )}
              </Space>
            </Card>
          </>
        ) : null}
      </Space>
    </AppShell>
  )
}
