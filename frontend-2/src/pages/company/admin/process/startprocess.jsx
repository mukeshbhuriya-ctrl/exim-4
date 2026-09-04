import { DownloadOutlined, ReloadOutlined, PlayCircleOutlined, EyeOutlined, FileExcelOutlined, FilePdfOutlined, ExclamationCircleOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { Alert, Button, Layout, Space, Typography, message, Card, Drawer, Tag, Radio, Tabs } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'
import ProDataTable from '../../../../components/shared/ProDataTable.jsx'
import { AccessControl } from '../../../../components/iam/AccessControl.jsx'

const { Title, Text } = Typography

function normalizeBatchList(data) {
  if (!data || typeof data !== 'object') return []
  if (Array.isArray(data.batches)) return data.batches
  return []
}

function formatMatchedAt(value) {
  if (value == null || value === '') return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString()
}

function normalizeRowList(value) {
  if (value == null) return []
  if (Array.isArray(value)) return value.filter((r) => r != null)
  if (typeof value === 'object') return [value]
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

function getMergedColumnsFromDetailRows(rows) {
  const keys = new Set()
  for (const item of rows) {
    const m = item?.merged
    if (m && typeof m === 'object') {
      for (const k of Object.keys(m)) {
        keys.add(k)
      }
    }
  }
  if (keys.size === 0) return getTableColumnsFromRows([])
  const synthetic = {}
  for (const k of keys) synthetic[k] = null
  return getTableColumnsFromRows([synthetic])
}

function tableScrollX(columnCount) {
  return Math.max(900, columnCount * 160)
}

function rowsForExcel(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return []
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return { value: String(row ?? '') }
    const out = {}
    for (const [k, v] of Object.entries(row)) {
      if (k === 'key') continue
      if (v == null) out[k] = ''
      else if (typeof v === 'object')
        try {
          out[k] = JSON.stringify(v)
        } catch {
          out[k] = ''
        }
      else out[k] = v
    }
    return out
  })
}

function asRowArray(value) {
  if (value == null) return []
  if (Array.isArray(value)) return value.filter((x) => x != null)
  if (typeof value === 'object') {
    if (Array.isArray(value.rows)) return value.rows.filter((x) => x != null)
    if (Array.isArray(value.items)) return value.items.filter((x) => x != null)
    if (Array.isArray(value.list)) return value.list.filter((x) => x != null)
    if (Array.isArray(value.data)) {
      const d = value.data
      if (d.length > 0 && typeof d[0] === 'object') return d.filter((x) => x != null)
    }
  }
  return []
}

const SALES_REMAINING_DETAIL_KEYS = [
  'salesRemainingRows',
  'remainingSalesRows',
  'remainingSales',
  'unmatchedSalesRows',
  'unmatchedSales',
  'salesNotMatchedRows',
  'sales_remaining_rows',
  'remaining_sales_rows',
]

const PDF_REMAINING_DETAIL_KEYS = [
  'pdfRemainingRows',
  'remainingPdfRows',
  'remainingPdfsRows',
  'remainingPdfs',
  'remainingPdf',
  'unmatchedPdfRows',
  'unmatchedPdfs',
  'pdf_not_matched_rows',
  'pdf_remaining_rows',
]

function firstDetailRowArray(obj, keys) {
  if (!obj || typeof obj !== 'object') return []
  for (const k of keys) {
    const arr = asRowArray(obj[k])
    if (arr.length) return arr
  }
  return []
}

function remainingFromNestedRemaining(detail) {
  const rem = detail?.remaining
  if (!rem || typeof rem !== 'object') return { sales: [], pdf: [] }
  return {
    sales: asRowArray(rem.sales ?? rem.salesRows),
    pdf: asRowArray(rem.pdf ?? rem.pdfs ?? rem.pdfRows),
  }
}

function buildSideSheetsForExport(detail, detailRows) {
  const empty = {
    salesRows: [],
    pdfRows: [],
    salesSheetTitle: 'Sales remaining',
    pdfSheetTitle: 'PDF remaining',
  }
  if (!detail || typeof detail !== 'object') return empty

  const nested = remainingFromNestedRemaining(detail)
  let salesRows = nested.sales
  let pdfRows = nested.pdf
  let salesTitle = 'Sales remaining'
  let pdfTitle = 'PDF remaining'

  if (!salesRows.length) {
    salesRows = firstDetailRowArray(detail, SALES_REMAINING_DETAIL_KEYS)
  }
  if (!pdfRows.length) {
    pdfRows = firstDetailRowArray(detail, PDF_REMAINING_DETAIL_KEYS)
  }

  if (!salesRows.length && Array.isArray(detailRows)) {
    salesRows = detailRows.map((r) => r?.salesRow).filter((x) => x != null && typeof x === 'object')
    if (salesRows.length) salesTitle = 'Matched sales rows'
  }
  if (!pdfRows.length && Array.isArray(detailRows)) {
    pdfRows = detailRows.map((r) => r?.pdfRow).filter((x) => x != null && typeof x === 'object')
    if (pdfRows.length) pdfTitle = 'Matched PDF rows'
  }

  return {
    salesRows,
    pdfRows,
    salesSheetTitle: salesTitle,
    pdfSheetTitle: pdfTitle,
  }
}

function flattenMaybeUploadRow(row) {
  if (!row || typeof row !== 'object') return { value: String(row ?? '') }
  if (row.data != null && typeof row.data === 'object' && !Array.isArray(row.data)) {
    return {
      ...row.data,
      ...(row.rowId != null ? { rowId: row.rowId } : {}),
      ...(row.pdfRowId != null ? { pdfRowId: row.pdfRowId } : {}),
      ...(row.uploadId != null ? { uploadId: row.uploadId } : {}),
      ...(row.source != null ? { source: row.source } : {}),
    }
  }
  return row
}

function sheetFromFlatRows(flatRows) {
  if (!flatRows.length) {
    return XLSX.utils.aoa_to_sheet([['(No rows)']])
  }
  return XLSX.utils.json_to_sheet(flatRows)
}

function safeExcelSheetName(name) {
  const cleaned = String(name).replace(/[:\\/?*[\]]/g, '-').trim()
  return (cleaned || 'Sheet').slice(0, 31)
}

function flattenUnmatchedRow(r) {
  if (!r || typeof r !== 'object') return { value: String(r ?? '') }
  const data = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {}
  return {
    ...data,
    ...(r.rowId != null ? { rowId: r.rowId } : {}),
    ...(r.pdfRowId != null ? { pdfRowId: r.pdfRowId } : {}),
    ...(r.rowIndex != null ? { rowIndex: r.rowIndex } : {}),
    ...(r.pdfRowIndex != null ? { pdfRowIndex: r.pdfRowIndex } : {}),
    ...(r.uploadId != null ? { uploadId: r.uploadId } : {}),
    ...(r.pdfUploadId != null ? { pdfUploadId: r.pdfUploadId } : {}),
    ...(r.source != null ? { source: r.source } : {}),
    ...(r.createdAt != null ? { createdAt: r.createdAt } : {}),
    ...(r.updatedAt != null ? { updatedAt: r.updatedAt } : {}),
  }
}

function getUnionColumnsFromFlatRows(rows) {
  const keys = new Set()
  for (const r of rows) {
    if (r && typeof r === 'object') Object.keys(r).forEach((k) => keys.add(k))
  }
  if (keys.size === 0) return getTableColumnsFromRows([])
  const synthetic = {}
  for (const k of keys) synthetic[k] = null
  return getTableColumnsFromRows([synthetic])
}

function downloadBatchExcelWorkbook(mergedRows, salesRemainingRaw, pdfRemainingRaw, salesSheetTitle, pdfSheetTitle) {
  const wb = XLSX.utils.book_new()

  const mergedFlat = rowsForExcel(mergedRows)
  XLSX.utils.book_append_sheet(wb, sheetFromFlatRows(mergedFlat), safeExcelSheetName('Merged'))

  const salesFlat = rowsForExcel(salesRemainingRaw.map(flattenMaybeUploadRow))
  XLSX.utils.book_append_sheet(wb, sheetFromFlatRows(salesFlat), safeExcelSheetName(salesSheetTitle || 'Sales remaining'))

  const pdfFlat = rowsForExcel(pdfRemainingRaw.map(flattenMaybeUploadRow))
  XLSX.utils.book_append_sheet(wb, sheetFromFlatRows(pdfFlat), safeExcelSheetName(pdfSheetTitle || 'PDF remaining'))

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  XLSX.writeFile(wb, `process-batch-${stamp}.xlsx`)
}

function downloadUnmatchedRowsExcel(salesFlatRows, pdfFlatRows) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    sheetFromFlatRows(rowsForExcel(salesFlatRows)),
    safeExcelSheetName('Sales unmatched'),
  )
  XLSX.utils.book_append_sheet(
    wb,
    sheetFromFlatRows(rowsForExcel(pdfFlatRows)),
    safeExcelSheetName('PDF unmatched'),
  )
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  XLSX.writeFile(wb, `unmatched-rows-${stamp}.xlsx`)
}

export default function CompanyAdminStartProcessPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [activeTab, setActiveTab] = useState('history')
  const [activeUnmatchedTable, setActiveUnmatchedTable] = useState('sales')

  const [batches, setBatches] = useState([])
  const [batchesLoading, setBatchesLoading] = useState(false)
  const [selectedBatchId, setSelectedBatchId] = useState(null)

  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [startingProcess, setStartingProcess] = useState(false)
  const [lastProcessResult, setLastProcessResult] = useState(null)

  const [unmatchedData, setUnmatchedData] = useState(null)
  const [unmatchedLoading, setUnmatchedLoading] = useState(false)

  const [batchesRefreshKey, setBatchesRefreshKey] = useState(0)
  const [unmatchedRefreshKey, setUnmatchedRefreshKey] = useState(0)
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)

  const fetchUnmatchedRows = useCallback(
    async ({ showError = true } = {}) => {
      if (!BACKEND_URL) return
      setUnmatchedLoading(true)
      try {
        const res = await fetch(`${BACKEND_URL}/api/company/admin/process/get-unmatched-rows`, {
          method: 'GET',
          credentials: 'include',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(
            data?.detail || data?.message || `Failed to load unmatched rows (${res.status})`,
          )
        }
        setUnmatchedData(data)
      } catch (err) {
        if (showError) {
          message.error(err instanceof Error ? err.message : 'Failed to load unmatched rows')
        }
        setUnmatchedData(null)
      } finally {
        setUnmatchedLoading(false)
      }
    },
    [BACKEND_URL],
  )

  const fetchProcessDates = useCallback(async () => {
    if (!BACKEND_URL) return
    setBatchesLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/process/process-dates`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load process batches (${res.status})`)
      }
      const list = normalizeBatchList(data).filter((b) => b && typeof b === 'object')
      setBatches(list)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load process batches')
      setBatches([])
    } finally {
      setBatchesLoading(false)
    }
  }, [BACKEND_URL])

  const fetchBatchDetail = useCallback(
    async (batchId) => {
      if (!BACKEND_URL || !batchId) return
      setDetailLoading(true)
      setDetail(null)
      try {
        const params = new URLSearchParams({ id: String(batchId) })
        const res = await fetch(
          `${BACKEND_URL}/api/company/admin/process/datiles-date-data?${params}`,
          {
            method: 'GET',
            credentials: 'include',
          },
        )
        const data = await res.json().catch(() => ({}))
        if (res.status === 404) {
          message.error(data?.message || data?.detail || 'No matches for this batch.')
          setDetail(null)
          return
        }
        if (!res.ok) {
          throw new Error(data?.detail || data?.message || `Failed to load batch (${res.status})`)
        }
        setDetail(data)
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Failed to load batch detail')
        setDetail(null)
      } finally {
        setDetailLoading(false)
      }
    },
    [BACKEND_URL],
  )

  const handleStartProcess = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    setStartingProcess(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/process/start-process`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to start process (${res.status})`)
      }
      if (data?.success === false) {
        throw new Error(data?.message || 'Process did not complete successfully')
      }
      setLastProcessResult(data)
      if (data?.batchId) {
        setSelectedBatchId(String(data.batchId))
      }
      message.success(data?.message || 'Process completed successfully')
      await Promise.all([fetchProcessDates(), fetchUnmatchedRows({ showError: false })])
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to start process')
    } finally {
      setStartingProcess(false)
    }
  }, [BACKEND_URL, fetchProcessDates, fetchUnmatchedRows])

  useEffect(() => {
    fetchProcessDates()
  }, [fetchProcessDates])

  useEffect(() => {
    fetchUnmatchedRows({ showError: false })
  }, [fetchUnmatchedRows])

  useEffect(() => {
    if (selectedBatchId) {
      fetchBatchDetail(selectedBatchId)
    } else {
      setDetail(null)
    }
  }, [selectedBatchId, fetchBatchDetail])

  // Data processing memos
  const detailRows = useMemo(() => normalizeRowList(detail?.rows), [detail])

  const mergedTableRows = useMemo(
    () =>
      detailRows.map((item, idx) => {
        const merged = item?.merged && typeof item.merged === 'object' ? item.merged : {}
        const id = item?.processMatch?.id
        const rowKey = String(id ?? idx)
        return {
          ...merged,
          key: rowKey,
        }
      }),
    [detailRows],
  )

  const mergedColumns = useMemo(() => getMergedColumnsFromDetailRows(detailRows), [detailRows])

  const sideSheetsForExport = useMemo(
    () => buildSideSheetsForExport(detail, detailRows),
    [detail, detailRows],
  )

  const unmatchedSalesRowsRaw = useMemo(
    () => (Array.isArray(unmatchedData?.salesRows) ? unmatchedData.salesRows : []),
    [unmatchedData],
  )
  const unmatchedPdfRowsRaw = useMemo(
    () => (Array.isArray(unmatchedData?.pdfRows) ? unmatchedData.pdfRows : []),
    [unmatchedData],
  )
  const unmatchedSalesRows = useMemo(
    () => unmatchedSalesRowsRaw.map(flattenUnmatchedRow),
    [unmatchedSalesRowsRaw],
  )
  const unmatchedPdfRows = useMemo(
    () => unmatchedPdfRowsRaw.map(flattenUnmatchedRow),
    [unmatchedPdfRowsRaw],
  )
  const unmatchedSalesColumns = useMemo(
    () => getUnionColumnsFromFlatRows(unmatchedSalesRows),
    [unmatchedSalesRows],
  )
  const unmatchedPdfColumns = useMemo(
    () => getUnionColumnsFromFlatRows(unmatchedPdfRows),
    [unmatchedPdfRows],
  )
  const unmatchedSalesCount = unmatchedData?.salesUnmatchedCount ?? unmatchedSalesRowsRaw.length
  const unmatchedPdfCount = unmatchedData?.pdfUnmatchedCount ?? unmatchedPdfRowsRaw.length

  const selectedBatch = useMemo(
    () => batches.find((b) => b != null && String(b.id) === selectedBatchId),
    [batches, selectedBatchId],
  )

  // Memory Bridge Updates
  useEffect(() => { setBatchesRefreshKey(r => r + 1) }, [batches])
  useEffect(() => { setUnmatchedRefreshKey(r => r + 1) }, [unmatchedSalesRows, unmatchedPdfRows])
  useEffect(() => { setDetailRefreshKey(r => r + 1) }, [mergedTableRows])

  // ProDataTable Fetchers
  const fetchBatchesData = useCallback(async ({ page, limit }) => {
    const start = (page - 1) * limit
    const paged = batches.slice(start, start + limit)
    return { data: paged, meta: { total: batches.length } }
  }, [batches])

  const fetchUnmatchedSalesData = useCallback(async ({ page, limit }) => {
    const start = (page - 1) * limit
    const paged = unmatchedSalesRows.slice(start, start + limit)
    return { data: paged, meta: { total: unmatchedSalesRows.length } }
  }, [unmatchedSalesRows])

  const fetchUnmatchedPdfData = useCallback(async ({ page, limit }) => {
    const start = (page - 1) * limit
    const paged = unmatchedPdfRows.slice(start, start + limit)
    return { data: paged, meta: { total: unmatchedPdfRows.length } }
  }, [unmatchedPdfRows])

  const fetchMergedData = useCallback(async ({ page, limit }) => {
    const start = (page - 1) * limit
    const paged = mergedTableRows.slice(start, start + limit)
    return { data: paged, meta: { total: mergedTableRows.length } }
  }, [mergedTableRows])

  const batchColumns = useMemo(
    () => [
      {
        title: 'Matched at',
        dataIndex: 'matchedAt',
        key: 'matchedAt',
        width: 180,
        render: (v) => formatMatchedAt(v),
      },
      {
        title: 'Total sales',
        dataIndex: 'totalSalesRowCount',
        key: 'totalSalesRowCount',
        width: 100,
        align: 'right',
        render: (v) => (v == null ? '—' : String(v)),
      },
      {
        title: 'Total PDF',
        dataIndex: 'totalPdfRowCount',
        key: 'totalPdfRowCount',
        width: 90,
        align: 'right',
        render: (v) => (v == null ? '—' : String(v)),
      },
      {
        title: 'Unmatched before',
        key: 'unmatchedBefore',
        width: 140,
        align: 'right',
        render: (_, record) => {
          const sales = record?.unmatchedSalesBeforeCount
          const pdf = record?.unmatchedPdfBeforeCount
          if (sales == null && pdf == null) return '—'
          return `${sales ?? '—'} sales / ${pdf ?? '—'} PDF`
        },
      },
      {
        title: 'Matches',
        dataIndex: 'matchCount',
        key: 'matchCount',
        width: 90,
        align: 'right',
        render: (v) => (v == null ? '—' : String(v)),
      },
      {
        title: 'Remaining after',
        key: 'remaining',
        width: 120,
        align: 'right',
        render: (_, record) => {
          const sales = record?.salesRemainingCount
          const pdf = record?.pdfRemainingCount
          if (sales == null && pdf == null) return '—'
          return `${sales ?? '—'} sales / ${pdf ?? '—'} PDF`
        },
      },
      {
        title: 'Unmatched inv in PDF',
        dataIndex: 'unmatchedInvoicesFoundInPdfCount',
        key: 'unmatchedInvoicesFoundInPdfCount',
        width: 140,
        align: 'right',
        render: (v) => (v == null ? '—' : String(v)),
      },
      {
        title: 'Action',
        key: 'action',
        width: 100,
        align: 'center',
        render: (_, record) => (
          <Button
            type="primary"
            ghost
            size="small"
            icon={<EyeOutlined />}
            onClick={() => setSelectedBatchId(record?.id != null ? String(record.id) : null)}
          >
            View Batch
          </Button>
        ),
      },
    ],
    [],
  )

  const handleExportBatchExcel = () => {
    if (!detail) return
    try {
      const { salesRows, pdfRows, salesSheetTitle, pdfSheetTitle } = sideSheetsForExport
      downloadBatchExcelWorkbook(mergedTableRows, salesRows, pdfRows, salesSheetTitle, pdfSheetTitle)
      message.success(
        `Exported Excel: Merged, ${salesSheetTitle}, ${pdfSheetTitle}.`,
      )
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Export failed')
    }
  }

  const handleExportUnmatchedExcel = useCallback(() => {
    if (!unmatchedData) {
      message.warning('Load unmatched rows first (refresh if needed).')
      return
    }
    try {
      downloadUnmatchedRowsExcel(unmatchedSalesRows, unmatchedPdfRows)
      message.success('Exported unmatched rows (2 sheets).')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Export failed')
    }
  }, [unmatchedData, unmatchedSalesRows, unmatchedPdfRows])

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <PageHeader
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, 
              borderRadius: 10, 
              background: 'linear-gradient(135deg, var(--exim-primary) 0%, #60a5fa 100%)', 
              display: 'flex', alignItems: 'center', justifyContent: 'center', 
              color: '#fff', 
              boxShadow: '0 4px 14px rgba(59, 130, 246, 0.25)',
              border: '1px solid rgba(255,255,255,0.2)'
            }}>
              <PlayCircleOutlined style={{ fontSize: 18 }} />
            </div>
            <span style={{ letterSpacing: '-0.5px' }}>Process Data Matching</span>
          </div>
        } 
        description="Run matching algorithms on uploaded sales and PDF data, and review historical match batches."
        actions={
          <AccessControl required="process:start_process:start">
          <Space size={12}>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                fetchProcessDates()
                fetchUnmatchedRows()
              }}
              disabled={!BACKEND_URL || batchesLoading || startingProcess}
            >
              Refresh Data
            </Button>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={startingProcess}
              onClick={handleStartProcess}
              disabled={!BACKEND_URL || startingProcess}
              style={{ 
                fontWeight: 600, 
                height: 38, 
                padding: '0 20px', 
                borderRadius: 8,
              }}
            >
              Start Process
            </Button>
          </Space>
          </AccessControl>
        
        }
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {lastProcessResult?.batchId ? (
          <Alert
            type={lastProcessResult.success === false ? 'warning' : 'success'}
            showIcon
            message="Last process run"
            style={{ marginBottom: 16, borderRadius: 8, border: '1px solid #bae0ff', background: '#e6f4ff' }}
            description={
              <Space direction="vertical" size={4}>
                {lastProcessResult.message ? <Text>{String(lastProcessResult.message)}</Text> : null}
                <Space wrap size={[12, 4]}>
                  <Text>Batch: <Text code>{String(lastProcessResult.batchId)}</Text></Text>
                  <Text>Total: <Text code>{lastProcessResult.totalSalesRowCount ?? '—'} S / {lastProcessResult.totalPdfRowCount ?? '—'} P</Text></Text>
                  <Text>New matches: <Text code>{lastProcessResult.matchesSaved ?? 0}</Text></Text>
                  <Text>Still unmatched: <Text code>{lastProcessResult.salesRemainingCount ?? '—'} S · {lastProcessResult.pdfRemainingCount ?? '—'} P</Text></Text>
                </Space>
              </Space>
            }
          />
        ) : null}

        <Tabs
          activeKey={activeTab.startsWith('unmatched') ? 'unmatched' : 'history'}
          onChange={(key) => {
             if (key === 'unmatched') {
                setActiveTab('unmatched-sales')
             } else {
                setActiveTab('history')
             }
          }}
          tabBarExtraContent={
             activeTab.startsWith('unmatched') && (
                 <Space>
                   <Button type="primary" icon={<DownloadOutlined />} onClick={handleExportUnmatchedExcel}>
                     Export to Excel
                   </Button>
                   <Button icon={<ReloadOutlined />} onClick={fetchUnmatchedRows}>
                     Refresh unmatched
                   </Button>
                 </Space>
             )
          }
          style={{ marginBottom: 0 }}
          items={[
            { key: 'history', label: 'Match batches' },
            { key: 'unmatched', label: 'Unmatched rows' }
          ]}
        />

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', paddingTop: 8 }}>
          {activeTab === 'history' && (
            <ProDataTable 
              columns={batchColumns} 
              fetchData={fetchBatchesData} 
              refreshKey={batchesRefreshKey}
              rowKey={(record) => String(record?.id || record?.key)}
              globalSearchPlaceholder="Search process batches..."
            />
          )}

          {activeTab.startsWith('unmatched') && (
             <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                   <Card 
                     style={{ flex: 1, borderRadius: 8, border: activeTab === 'unmatched-sales' ? '2px solid var(--exim-primary, #1677ff)' : '1px solid #e2e8f0', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.02)' }} 
                     bodyStyle={{ padding: '12px 16px' }}
                     onClick={() => setActiveTab('unmatched-sales')}
                   >
                     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                       <div>
                          <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Sales unmatched</Text>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                             <Title level={2} style={{ margin: 0, fontSize: 24, color: 'var(--exim-gray-800)' }}>{unmatchedSalesCount}</Title>
                             <Text type="secondary" style={{ fontSize: 12 }}>
                                of {unmatchedData?.totalSalesRowCount || 0} sales rows · {unmatchedData ? (unmatchedData.totalSalesRowCount - unmatchedSalesCount) : 0} matched
                             </Text>
                          </div>
                       </div>
                       <Button size="middle" type={activeTab === 'unmatched-sales' ? 'primary' : 'default'} style={{ fontWeight: 500 }}>View rows</Button>
                     </div>
                   </Card>

                   <Card 
                     style={{ flex: 1, borderRadius: 8, border: activeTab === 'unmatched-pdf' ? '2px solid var(--exim-primary, #1677ff)' : '1px solid #e2e8f0', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.02)' }} 
                     bodyStyle={{ padding: '12px 16px' }}
                     onClick={() => setActiveTab('unmatched-pdf')}
                   >
                     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                       <div>
                          <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>PDF unmatched</Text>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                             <Title level={2} style={{ margin: 0, fontSize: 24, color: 'var(--exim-gray-800)' }}>{unmatchedPdfCount}</Title>
                             <Text type="secondary" style={{ fontSize: 12 }}>
                                of {unmatchedData?.totalPdfRowCount || 0} pdf rows · {unmatchedData ? (unmatchedData.totalPdfRowCount - unmatchedPdfCount) : 0} matched
                             </Text>
                          </div>
                       </div>
                       <Button size="middle" type={activeTab === 'unmatched-pdf' ? 'primary' : 'default'} style={{ fontWeight: 500 }}>View rows</Button>
                     </div>
                   </Card>
                </div>

                {activeTab === 'unmatched-sales' && (
                  <ProDataTable 
                    columns={unmatchedSalesColumns} 
                    fetchData={fetchUnmatchedSalesData} 
                    refreshKey={unmatchedRefreshKey}
                    rowKey={(r, i) => String(r?.rowId ?? `sales-${i}`)}
                    globalSearchPlaceholder="Search unmatched sales..."
                  />
                )}
                {activeTab === 'unmatched-pdf' && (
                  <ProDataTable 
                    columns={unmatchedPdfColumns} 
                    fetchData={fetchUnmatchedPdfData} 
                    refreshKey={unmatchedRefreshKey}
                    rowKey={(r, i) => String(r?.pdfRowId ?? r?.rowId ?? `pdf-${i}`)}
                    globalSearchPlaceholder="Search unmatched PDFs..."
                  />
                )}
             </div>
          )}
        </div>
      </div>

      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>Batch Detail: Merged Rows</span>
            {detail?.matchedAt != null && <Tag color="blue">Matched: {formatMatchedAt(detail.matchedAt)}</Tag>}
            {detail?.count != null && <Tag color="green">Merged Rows: {detail.count}</Tag>}
          </div>
        }
        placement="right"
        width="90%"
        onClose={() => setSelectedBatchId(null)}
        open={!!selectedBatchId}
        extra={
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleExportBatchExcel} disabled={!detail || detailLoading}>
            Export Full Batch
          </Button>
        }
        bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#f8fafc', padding: '16px' }}>
          <ProDataTable 
            columns={mergedColumns} 
            fetchData={fetchMergedData} 
            refreshKey={detailRefreshKey}
            rowKey="key"
            globalSearchPlaceholder="Search merged rows..."
          />
        </div>
      </Drawer>
    </AppShell>
  )
}
