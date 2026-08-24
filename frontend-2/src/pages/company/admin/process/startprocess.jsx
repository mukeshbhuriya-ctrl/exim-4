import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Layout, Space, Table, Typography, message } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
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

/** Union of keys across all merged objects so wide rows still get columns. */
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

/** Min width for Table scroll.x from column count. */
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

/** Value is an array of row objects, or an object wrapping `rows` / `items` / `list` / `data`. */
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

/** Optional nested `remaining: { sales?, pdf? }` shape. */
function remainingFromNestedRemaining(detail) {
  const rem = detail?.remaining
  if (!rem || typeof rem !== 'object') return { sales: [], pdf: [] }
  return {
    sales: asRowArray(rem.sales ?? rem.salesRows),
    pdf: asRowArray(rem.pdf ?? rem.pdfs ?? rem.pdfRows),
  }
}

/**
 * Sales / PDF sheets: prefer true remaining arrays from API; unwrap `{ rows: [] }`;
 * if still empty, export each match's salesRow / pdfRow so sheets are not blank.
 */
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

/** Slim upload-row shape: spread `data` and keep ids for export. */
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

  const [batches, setBatches] = useState([])
  const [batchesLoading, setBatchesLoading] = useState(false)
  const [selectedBatchId, setSelectedBatchId] = useState(null)

  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [startingProcess, setStartingProcess] = useState(false)
  const [lastProcessResult, setLastProcessResult] = useState(null)

  const [unmatchedData, setUnmatchedData] = useState(null)
  const [unmatchedLoading, setUnmatchedLoading] = useState(false)
  const [unmatchedSalesVisible, setUnmatchedSalesVisible] = useState(false)
  const [unmatchedPdfVisible, setUnmatchedPdfVisible] = useState(false)

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
  const unmatchedSalesCount =
    unmatchedData?.salesUnmatchedCount ?? unmatchedSalesRowsRaw.length
  const unmatchedPdfCount = unmatchedData?.pdfUnmatchedCount ?? unmatchedPdfRowsRaw.length

  const selectedBatch = useMemo(
    () => batches.find((b) => b != null && String(b.id) === selectedBatchId),
    [batches, selectedBatchId],
  )

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
        title: '',
        key: 'action',
        width: 80,
        render: (_, record) => (
          <Button
            type="link"
            size="small"
            onClick={() => setSelectedBatchId(record?.id != null ? String(record.id) : null)}
          >
            View
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
          <Space direction="vertical" size="large" style={{ width: '100%', maxWidth: '100%' }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                Process batches
              </Title>
              <Text type="secondary">
                Run matching on sales and PDF data already uploaded for your company. Then open a batch below to see
                merged rows.
              </Text>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              <Button
                type="primary"
                loading={startingProcess}
                onClick={handleStartProcess}
                disabled={!BACKEND_URL || startingProcess}
              >
                Start process
              </Button>
              <Button
                icon={<ReloadOutlined />}
                loading={batchesLoading || unmatchedLoading}
                onClick={() => {
                  fetchProcessDates()
                  fetchUnmatchedRows()
                }}
                disabled={!BACKEND_URL || batchesLoading || startingProcess}
              >
                Refresh
              </Button>
            </div>

            {lastProcessResult?.batchId ? (
              <Alert
                type={lastProcessResult.success === false ? 'warning' : 'success'}
                showIcon
                message="Last process run"
                description={
                  <Space direction="vertical" size={4}>
                    {lastProcessResult.message ? <Text>{String(lastProcessResult.message)}</Text> : null}
                    <Space wrap size={[12, 4]}>
                      <Text>
                        Batch: <Text code>{String(lastProcessResult.batchId)}</Text>
                      </Text>
                      <Text>
                        Total sales / PDF:{' '}
                        <Text code>
                          {lastProcessResult.totalSalesRowCount ?? '—'} /{' '}
                          {lastProcessResult.totalPdfRowCount ?? '—'}
                        </Text>
                      </Text>
                      <Text>
                        Unmatched before:{' '}
                        <Text code>
                          {lastProcessResult.unmatchedSalesBeforeCount ?? '—'} sales ·{' '}
                          {lastProcessResult.unmatchedPdfBeforeCount ?? '—'} PDF
                        </Text>
                      </Text>
                      <Text>
                        Unmatched invoices in PDF:{' '}
                        <Text code>{lastProcessResult.unmatchedInvoicesFoundInPdfCount ?? '—'}</Text>
                      </Text>
                      <Text>
                        New matches: <Text code>{lastProcessResult.matchesSaved ?? 0}</Text>
                      </Text>
                      <Text>
                        Still unmatched:{' '}
                        <Text code>
                          {lastProcessResult.salesRemainingCount ?? '—'} sales ·{' '}
                          {lastProcessResult.pdfRemainingCount ?? '—'} PDF
                        </Text>
                      </Text>
                    </Space>
                  </Space>
                }
              />
            ) : null}

            <div style={{ width: '100%', minWidth: 0 }}>
              <Space
                align="center"
                wrap
                style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}
              >
                <Text strong>Unmatched rows</Text>
                <Space wrap size="small">
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    size="small"
                    onClick={handleExportUnmatchedExcel}
                    disabled={!BACKEND_URL || unmatchedLoading || !unmatchedData}
                  >
                    Export to Excel
                  </Button>
                  <Button
                    icon={<ReloadOutlined />}
                    size="small"
                    loading={unmatchedLoading}
                    onClick={() => fetchUnmatchedRows()}
                    disabled={!BACKEND_URL || unmatchedLoading}
                  >
                    Refresh unmatched
                  </Button>
                </Space>
              </Space>
              <Space wrap size={16} align="start" style={{ marginBottom: 12 }}>
                <div
                  style={{
                    minWidth: 240,
                    padding: '12px 16px',
                    border: '1px solid #f0f0f0',
                    borderRadius: 8,
                    background: '#fafafa',
                  }}
                >
                  <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                    Sales unmatched
                  </Text>
                  <Title level={3} style={{ margin: 0, lineHeight: 1 }}>
                    {unmatchedSalesCount}
                  </Title>
                  {unmatchedData?.totalSalesRowCount != null ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      of {unmatchedData.totalSalesRowCount} sales rows
                      {unmatchedData?.matchedSalesRowCount != null
                        ? ` · ${unmatchedData.matchedSalesRowCount} matched`
                        : ''}
                    </Text>
                  ) : null}
                  <div style={{ marginTop: 8 }}>
                    <Button
                      size="small"
                      type={unmatchedSalesVisible ? 'default' : 'primary'}
                      onClick={() => setUnmatchedSalesVisible((v) => !v)}
                      disabled={unmatchedLoading}
                    >
                      {unmatchedSalesVisible ? 'Hide rows' : 'View rows'}
                    </Button>
                  </div>
                </div>
                <div
                  style={{
                    minWidth: 240,
                    padding: '12px 16px',
                    border: '1px solid #f0f0f0',
                    borderRadius: 8,
                    background: '#fafafa',
                  }}
                >
                  <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                    PDF unmatched
                  </Text>
                  <Title level={3} style={{ margin: 0, lineHeight: 1 }}>
                    {unmatchedPdfCount}
                  </Title>
                  {unmatchedData?.totalPdfRowCount != null ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      of {unmatchedData.totalPdfRowCount} pdf rows
                      {unmatchedData?.matchedPdfRowCount != null
                        ? ` · ${unmatchedData.matchedPdfRowCount} matched`
                        : ''}
                    </Text>
                  ) : null}
                  <div style={{ marginTop: 8 }}>
                    <Button
                      size="small"
                      type={unmatchedPdfVisible ? 'default' : 'primary'}
                      onClick={() => setUnmatchedPdfVisible((v) => !v)}
                      disabled={unmatchedLoading}
                    >
                      {unmatchedPdfVisible ? 'Hide rows' : 'View rows'}
                    </Button>
                  </div>
                </div>
              </Space>

              {unmatchedSalesVisible ? (
                <div
                  style={{
                    marginBottom: 16,
                    width: '100%',
                    minWidth: 0,
                    maxWidth: '100%',
                    overflowX: 'auto',
                  }}
                >
                  <Text strong style={{ display: 'block', marginBottom: 8 }}>
                    Sales unmatched rows ({unmatchedSalesRows.length})
                  </Text>
                  <Table
                    size="small"
                    loading={unmatchedLoading}
                    rowKey={(r, i) => String(r?.rowId ?? `sales-${i}`)}
                    columns={unmatchedSalesColumns}
                    dataSource={unmatchedSalesRows}
                    pagination={{ pageSize: 10, showSizeChanger: true }}
                    scroll={{ x: tableScrollX(unmatchedSalesColumns.length), y: 360 }}
                    locale={{
                      emptyText: unmatchedLoading ? 'Loading…' : 'No unmatched sales rows',
                    }}
                  />
                </div>
              ) : null}

              {unmatchedPdfVisible ? (
                <div
                  style={{
                    marginBottom: 16,
                    width: '100%',
                    minWidth: 0,
                    maxWidth: '100%',
                    overflowX: 'auto',
                  }}
                >
                  <Text strong style={{ display: 'block', marginBottom: 8 }}>
                    PDF unmatched rows ({unmatchedPdfRows.length})
                  </Text>
                  <Table
                    size="small"
                    loading={unmatchedLoading}
                    rowKey={(r, i) => String(r?.pdfRowId ?? r?.rowId ?? `pdf-${i}`)}
                    columns={unmatchedPdfColumns}
                    dataSource={unmatchedPdfRows}
                    pagination={{ pageSize: 10, showSizeChanger: true }}
                    scroll={{ x: tableScrollX(unmatchedPdfColumns.length), y: 360 }}
                    locale={{
                      emptyText: unmatchedLoading ? 'Loading…' : 'No unmatched PDF rows',
                    }}
                  />
                </div>
              ) : null}
            </div>

            <div style={{ width: '100%', minWidth: 0 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>
                Match batches ({batches.length})
              </Text>
              <Table
                size="small"
                loading={batchesLoading}
                rowKey={(record, index) => String(record?.id ?? `batch-${index}`)}
                columns={batchColumns}
                dataSource={batches}
                pagination={{ pageSize: 10, showSizeChanger: true }}
                locale={{ emptyText: 'No process batches yet' }}
                onRow={(record) => ({
                  onClick: () => {
                    if (record?.id != null) setSelectedBatchId(String(record.id))
                  },
                  style: {
                    cursor: record?.id != null ? 'pointer' : 'default',
                    background:
                      selectedBatchId != null && String(record?.id) === selectedBatchId ? '#e6f4ff' : undefined,
                  },
                })}
              />
            </div>

            {selectedBatchId ? (
              <div style={{ width: '100%', minWidth: 0 }}>
                <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                  <div>
                    <Title level={5} style={{ margin: 0 }}>
                      Batch detail — merged rows
                    </Title>
                    <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                      {detail?.matchedAt != null ? <>Matched at: {formatMatchedAt(detail.matchedAt)}</> : null}
                      {(selectedBatch?.totalSalesRowCount ?? detail?.totalSalesRowCount) != null ? (
                        <>
                          {detail?.matchedAt != null ? ' · ' : null}
                          Total sales / PDF: {selectedBatch?.totalSalesRowCount ?? detail?.totalSalesRowCount} /{' '}
                          {selectedBatch?.totalPdfRowCount ?? detail?.totalPdfRowCount}
                        </>
                      ) : null}
                      {(selectedBatch?.unmatchedSalesBeforeCount ?? detail?.unmatchedSalesBeforeCount) !=
                      null ? (
                        <>
                          {' · '}
                          Unmatched before:{' '}
                          {selectedBatch?.unmatchedSalesBeforeCount ?? detail?.unmatchedSalesBeforeCount} sales /{' '}
                          {selectedBatch?.unmatchedPdfBeforeCount ?? detail?.unmatchedPdfBeforeCount} PDF
                        </>
                      ) : null}
                      {detail?.count != null ? (
                        <>
                          {' · '}
                          Merged rows: {detail.count}
                        </>
                      ) : null}
                      {(selectedBatch?.salesRemainingCount ?? detail?.salesRemainingCount) != null ? (
                        <>
                          {' · '}
                          Sales remaining: {selectedBatch?.salesRemainingCount ?? detail?.salesRemainingCount}
                        </>
                      ) : null}
                      {(selectedBatch?.pdfRemainingCount ?? detail?.pdfRemainingCount) != null ? (
                        <>
                          {' · '}
                          PDF remaining: {selectedBatch?.pdfRemainingCount ?? detail?.pdfRemainingCount}
                        </>
                      ) : null}
                    </Text>
                  </div>
                  <Space>
                    <Button onClick={() => setSelectedBatchId(null)} disabled={detailLoading}>
                      Close detail
                    </Button>
                    <Button
                      type="primary"
                      icon={<DownloadOutlined />}
                      onClick={handleExportBatchExcel}
                      disabled={!detail || detailLoading}
                    >
                      Export to Excel
                    </Button>
                  </Space>
                </Space>

                <div
                  style={{
                    marginTop: 12,
                    width: '100%',
                    minWidth: 0,
                    maxWidth: '100%',
                    overflowX: 'auto',
                    WebkitOverflowScrolling: 'touch',
                    boxSizing: 'border-box',
                  }}
                >
                  <Table
                    size="small"
                    loading={detailLoading}
                    rowKey="key"
                    columns={mergedColumns}
                    dataSource={mergedTableRows}
                    locale={{ emptyText: detailLoading ? 'Loading…' : 'No merged rows in this batch' }}
                    tableLayout="fixed"
                    scroll={{ x: tableScrollX(mergedColumns.length), y: 400 }}
                  />
                </div>
              </div>
            ) : null}
          </Space>
        </AppShell>
  )
}
