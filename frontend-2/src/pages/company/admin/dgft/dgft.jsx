import {
  Button,
  Descriptions,
  Input,
  InputNumber,
  Layout,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  DownloadOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography

function normalizeInputsResponse(data) {
  if (!data || typeof data !== 'object') return []
  if (Array.isArray(data.rows)) return data.rows
  if (Array.isArray(data.data)) return data.data
  if (Array.isArray(data.items)) return data.items
  if (Array.isArray(data.inputs)) return data.inputs
  if (Array.isArray(data)) return data
  return []
}

function normalizeDaysResponse(data) {
  if (!data || typeof data !== 'object') return []
  if (Array.isArray(data.days)) return data.days
  if (Array.isArray(data.batches)) return data.batches
  if (Array.isArray(data.rows)) return data.rows
  if (Array.isArray(data.data)) return data.data
  if (Array.isArray(data)) return data
  return []
}

function normalizeDetailResponse(data) {
  if (!data || typeof data !== 'object') return null
  if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) return data.data
  return data
}

function normalizeTableRows(detail) {
  const rows = detail?.tableRows
  if (Array.isArray(rows)) return rows
  if (rows && typeof rows === 'object') {
    if (Array.isArray(rows.rows)) return rows.rows
    if (Array.isArray(rows.data)) return rows.data
    return [rows]
  }
  return []
}

const BRC_DETAIL_KEY = 'brcDetail'

/** Same header strings as legacy scraped `tableRows` from DGFT portal. */
const DGFT_BRC_TABLE_COL = {
  BRC_ISSUE_DATE: 'BRC Issue Date',
  BANK_REALISATION_NUMBER: 'Bank Realisation Number',
  BANK_REALISATION_STATUS: 'Bank Realisation Status',
  BILL_ID: 'Bill ID',
  CANCEL_EBRC: 'Cancel eBRC',
  REALISED_IN_BANK_DATE: 'Date on which the amount is realized in the bank',
  FOB_FC: 'FOB value realized in the foreign currency code',
  GST_DETAILS: 'GST Details',
  SB_DATE: 'Shipping Bill Date',
  SB_NUMBER: 'Shipping Bill Number',
  SB_PORT: 'Shipping Bill Port',
  UTILISATION_STATUS: 'Utilisation Status',
}

function portFromCodeObject(code) {
  if (code == null) return '—'
  if (typeof code === 'string') return code.trim() || '—'
  if (typeof code === 'object' && code.value != null) return String(code.value)
  return '—'
}

function brcStatusDisplay(datum, dr) {
  const drs = dr?.brcStatus
  if (drs != null && String(drs).trim() !== '') return String(drs).trim()
  const bs = datum?.brcStatus
  if (typeof bs === 'string' && bs.trim()) return bs.trim()
  if (bs && typeof bs === 'object' && bs.value != null) return String(bs.value)
  return '—'
}

function utilisationDisplay(datum, dr) {
  const u = datum?.utilizationStatus
  if (u != null && String(u).trim() !== '') return String(u).trim()
  const f = dr?.utilizationF
  if (f === 'true' || f === true) return 'Yes'
  if (f === 'false' || f === false) return 'No'
  if (f != null && String(f).trim() !== '') return String(f).trim()
  return '—'
}

function gstDetailsDisplay(dr, datum) {
  const parts = []
  if (dr?.gstIn) parts.push(`GSTIN: ${dr.gstIn}`)
  if (dr?.gstinInvoiceNumber) parts.push(`Invoice: ${dr.gstinInvoiceNumber}`)
  if (dr?.gstinInvoiceDate) parts.push(`Date: ${dr.gstinInvoiceDate}`)
  if (datum?.gstinBranch) parts.push(String(datum.gstinBranch))
  if (parts.length) return parts.join(' · ')
  if (datum?.isGstAvail != null) return String(datum.isGstAvail)
  return '—'
}

function cancelEbrcDisplay(datum, dr) {
  const v =
    dr?.cancelEbrc ??
    dr?.cancelEBRC ??
    datum?.cancelEbrc ??
    datum?.cancelRemarks ??
    datum?.cancelEbrcMessage
  if (v != null && String(v).trim() !== '') return String(v).trim()
  return '—'
}

/** When `tableRows` is empty but `brcResponse.data` is populated (JSON API shape). */
function normalizeDetailRowsFromBrcApi(detail) {
  const raw = detail?.brcResponse
  const data = Array.isArray(raw?.data) ? raw.data : []
  if (!data.length) return []
  const C = DGFT_BRC_TABLE_COL
  return data.map((datum) => {
    const dr =
      datum?.detailResponse && typeof datum.detailResponse === 'object' && !Array.isArray(datum.detailResponse)
        ? datum.detailResponse
        : {}
    const pdfUrl = datum.pdfUrl || dr.pdfUrl || null
    const brcNumber = dr.brcNumber ?? datum.brcNumber ?? '—'
    const row = {
      [C.BRC_ISSUE_DATE]: dr.uploadDate ?? datum.uploadDate ?? '—',
      [C.BANK_REALISATION_NUMBER]: brcNumber,
      [C.BANK_REALISATION_STATUS]: brcStatusDisplay(datum, dr),
      [C.BILL_ID]: dr.invoiceNumber ?? datum.invoiceNumber ?? '—',
      [C.CANCEL_EBRC]: cancelEbrcDisplay(datum, dr),
      [C.REALISED_IN_BANK_DATE]: dr.realisationDate ?? datum.realisationDate ?? '—',
      [C.FOB_FC]: dr.netRealizedValueFc ?? dr.realizedAmountCC ?? datum.realizedAmountCC ?? '—',
      [C.GST_DETAILS]: gstDetailsDisplay(dr, datum),
      [C.SB_DATE]: dr.sbDate ?? datum.sbDate ?? '—',
      [C.SB_NUMBER]: dr.sbNumber ?? datum.sbNumber ?? '—',
      [C.SB_PORT]:
        portFromCodeObject(datum.exportPortCode) !== '—'
          ? portFromCodeObject(datum.exportPortCode)
          : dr.exportPortCode != null && String(dr.exportPortCode).trim() !== ''
            ? String(dr.exportPortCode).trim()
            : '—',
      [C.UTILISATION_STATUS]: utilisationDisplay(datum, dr),
    }
    row[BRC_DETAIL_KEY] = {
      ...dr,
      pdfUrl: pdfUrl || undefined,
      brNumber: brcNumber,
    }
    return row
  })
}

function mergeDetailRows(detail) {
  const fromTable = normalizeTableRows(detail)
  if (fromTable.length) return fromTable
  return normalizeDetailRowsFromBrcApi(detail)
}

function fmtDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString()
}

function statusColor(status) {
  const s = String(status || '').toLowerCase()
  if (s.includes('success')) return 'green'
  if (s.includes('error') || s.includes('fail')) return 'red'
  if (s.includes('process') || s.includes('pending')) return 'gold'
  return 'default'
}

function cellText(value) {
  if (value == null || value === '') return '—'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return '[Object]'
    }
  }
  return String(value)
}

const FETCH_USING_OPTIONS = [
  { value: 'dricat', label: 'dricat' },
  { value: 'selenium', label: 'selenium' },
]

function normalizeFetchUsing(value) {
  const v = String(value || '').trim().toLowerCase()
  if (v === 'dricat') return v
  return 'dricat'
}

function normalizeUnfetchedCountResponse(data) {
  if (!data || typeof data !== 'object') return null
  const collections = Array.isArray(data.collections)
    ? data.collections.map((c) => String(c))
    : []
  return {
    totalShippingBillNo: Number(data.totalShippingBillNo ?? data.totalSbNo ?? data.registeredCount) || 0,
    totalShippingBillNoUnique:
      Number(data.totalShippingBillNoUnique ?? data.totalSbNoUnique ?? data.registeredUniqueSbNoCount) || 0,
    totalFetchedShippingBill:
      Number(
        data.totalFetchedShippingBill ??
          data.fetchedSuccessSbNo ??
          data.fetchedSuccessSbNoCount ??
          data.fetchedSuccessCount,
      ) || 0,
    totalFetchedShippingBillUnique: Number(data.totalFetchedShippingBillUnique) || 0,
    filterDgftSbNo: Number(data.filterDgftSbNo ?? data.dgftTrueRegisteredCount) || 0,
    filterDgftSbNoUnique:
      Number(data.filterDgftSbNoUnique ?? data.dgftTrueRegisteredUniqueSbNoCount) || 0,
    filterDgftSbNoNotFetched:
      Number(data.filterDgftSbNoNotFetched ?? data.filterDgftSbNoFetchedSuccess) || 0,
    filterDgftSbNoNotFetchedUnique:
      Number(data.filterDgftSbNoNotFetchedUnique ?? data.filterDgftSbNoFetchedSuccessUnique) || 0,
    filterDgftSbNofetchederror:
      Number(
        data.filterDgftSbNofetchederror ??
          data.filterDgftSbNoUnfetched ??
          data.filterDgftSbNoFetchFailed ??
          data.dgftTrueUnfetchedCount,
      ) || 0,
    filterDgftSbNofetchederrorUnique:
      Number(
        data.filterDgftSbNofetchederrorUnique ??
          data.filterDgftSbNoUnfetchedUnique ??
          data.filterDgftSbNoFetchFailedUnique ??
          data.dgftTrueUnfetchedUniqueSbNoCount,
      ) || 0,
    message: data.message ? String(data.message) : '',
    collections,
  }
}

function normalizeInputObject(input) {
  if (!input) return {}
  if (typeof input === 'object' && !Array.isArray(input)) return input
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      return {}
    }
  }
  return {}
}

function pickInputField(inputObj, keys) {
  for (const key of keys) {
    const value = inputObj?.[key]
    if (value != null && String(value).trim() !== '') return String(value).trim()
  }
  return '—'
}

function hasBrcDetail(record) {
  const b = record?.[BRC_DETAIL_KEY]
  return b != null && typeof b === 'object' && !Array.isArray(b)
}

function buildDetailTableColumns(rows) {
  const keySet = new Set()
  for (const row of rows) {
    if (row && typeof row === 'object') {
      Object.keys(row).forEach((k) => {
        if (k !== BRC_DETAIL_KEY) keySet.add(k)
      })
    }
  }
  if (keySet.size === 0) {
    return [
      {
        title: 'Value',
        dataIndex: 'value',
        key: 'value',
        render: (v) => cellText(v),
      },
    ]
  }
  return Array.from(keySet).map((k) => ({
    title: k,
    dataIndex: k,
    key: k,
    ellipsis: true,
    render: (v) => cellText(v),
  }))
}

function safeFilenamePart(value, fallback) {
  const s = String(value ?? '').trim()
  const cleaned = s.replace(/[^0-9a-zA-Z._-]+/g, '_')
  return cleaned || String(fallback ?? 'record')
}

function safeExcelSheetName(name) {
  const cleaned = String(name).replace(/[:\\/?*[\]]/g, '-').trim()
  return (cleaned || 'Sheet').slice(0, 31)
}

function flattenBrcRowForExcel(row) {
  if (!row || typeof row !== 'object') return { value: String(row ?? '') }
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === BRC_DETAIL_KEY) continue
    if (v == null) out[k] = ''
    else if (typeof v === 'object') {
      try {
        out[k] = JSON.stringify(v)
      } catch {
        out[k] = ''
      }
    } else out[k] = v
  }
  const brc = row[BRC_DETAIL_KEY]
  if (brc && typeof brc === 'object') {
    for (const [k, v] of Object.entries(brc)) {
      const key = `brcDetail_${k}`
      if (v == null) out[key] = ''
      else if (typeof v === 'object') {
        try {
          out[key] = JSON.stringify(v)
        } catch {
          out[key] = ''
        }
      } else out[key] = v
    }
  }
  return out
}

function inputSummaryForExcel(rec) {
  const inputObj = normalizeInputObject(rec?.input)
  return {
    recordId: rec?.id ?? '',
    inputSbNo: pickInputField(inputObj, ['sbNo', 'sbNumber', 'sb_number']),
    inputSbDate: pickInputField(inputObj, ['sbDate', 'sb_date']),
    inputSbLocation: pickInputField(inputObj, ['sbLocation', 'sb_location', 'port']),
    status: rec?.status ?? '',
    dayKey: rec?.dayKey ?? '',
    batchId: rec?.batchId ?? '',
    createdAt: rec?.createdAt ?? '',
    updatedAt: rec?.updatedAt ?? '',
  }
}

function buildDgftExcelRows(record, detailRows) {
  const meta = inputSummaryForExcel(record)
  if (!Array.isArray(detailRows) || detailRows.length === 0) {
    return [meta]
  }
  return detailRows.map((row) => ({ ...meta, ...flattenBrcRowForExcel(row) }))
}

function downloadDgftRecordExcel(record, detailRows) {
  const wb = XLSX.utils.book_new()
  const rows = buildDgftExcelRows(record, detailRows)
  const ws =
    rows.length > 0 && Object.keys(rows[0]).length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([['(No rows)']])
  XLSX.utils.book_append_sheet(wb, ws, safeExcelSheetName('Data'))
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const inputObj = normalizeInputObject(record?.input)
  const sbNoRaw = pickInputField(inputObj, ['sbNo', 'sbNumber', 'sb_number'])
  const sb = safeFilenamePart(sbNoRaw === '—' ? record?.id ?? 'record' : sbNoRaw, 'record')
  XLSX.writeFile(wb, `dgft-${sb}-${stamp}.xlsx`)
}

function downloadDgftCombinedExcel(allRows) {
  const wb = XLSX.utils.book_new()
  const ws =
    allRows.length > 0 && Object.keys(allRows[0]).length > 0
      ? XLSX.utils.json_to_sheet(allRows)
      : XLSX.utils.aoa_to_sheet([['(No rows)']])
  XLSX.utils.book_append_sheet(wb, ws, safeExcelSheetName('Data'))
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  XLSX.writeFile(wb, `dgft-all-${stamp}.xlsx`)
}

function parseMultiSbNos(input) {
  const text = String(input ?? '').trim()
  if (!text) return []
  return [
    ...new Set(
      text
        .split(/[\s,;|]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ]
}

async function downloadPdfFromUrl(url, filename) {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename || 'document.pdf'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objectUrl)
  } catch {
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = filename || 'document.pdf'
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      message.error('Could not download PDF (CORS or network). Try View and save from the viewer.')
    }
  }
}

export default function CompanyAdminDgftPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [days, setDays] = useState([])
  const [daysLoading, setDaysLoading] = useState(false)
  const [selectedDayKey, setSelectedDayKey] = useState(null)

  const [records, setRecords] = useState([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  const [detail, setDetail] = useState(null)
  const [detailRows, setDetailRows] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [pdfModalUrl, setPdfModalUrl] = useState(null)
  const [submittingRandomTen, setSubmittingRandomTen] = useState(false)
  const [fetchUsing, setFetchUsing] = useState('dricat')
  const [sampleSize, setSampleSize] = useState(10)

  const [unfetchedCount, setUnfetchedCount] = useState(null)
  const [unfetchedCountLoading, setUnfetchedCountLoading] = useState(false)

  const [searchInput, setSearchInput] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchMode, setSearchMode] = useState(false)
  const [searchedSbNos, setSearchedSbNos] = useState([])
  const [notFoundSbNos, setNotFoundSbNos] = useState([])
  const [exportingAll, setExportingAll] = useState(false)

  const clearSearch = useCallback(() => {
    setSearchInput('')
    setSearchMode(false)
    setSearchedSbNos([])
    setNotFoundSbNos([])
    if (!selectedDayKey) {
      setRecords([])
      setSelectedId(null)
    }
  }, [selectedDayKey])

  const applySearch = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    const sbNos = parseMultiSbNos(searchInput)
    if (!sbNos.length) {
      message.warning('Enter one or more SB numbers (comma or space separated).')
      return
    }

    setSearchLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/dgft/search-by-sb-no`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sbNos }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Search failed (${res.status})`)
      }
      const rows = normalizeInputsResponse(data).filter((r) => r && typeof r === 'object')
      setSelectedDayKey(null)
      setSelectedId(null)
      setDetail(null)
      setDetailRows([])
      setSearchMode(true)
      setSearchedSbNos(Array.isArray(data?.searchedSbNos) ? data.searchedSbNos : sbNos)
      setNotFoundSbNos(Array.isArray(data?.notFoundSbNos) ? data.notFoundSbNos : [])
      setRecords(rows)
      if (!rows.length) {
        message.info('No DGFT records found for the given SB No(s).')
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to search DGFT records')
    } finally {
      setSearchLoading(false)
    }
  }, [BACKEND_URL, searchInput])

  const hasActiveSearch = searchMode
  const filteredRecords = records

  const fetchUnfetchedCount = useCallback(async () => {
    if (!BACKEND_URL) return
    setUnfetchedCountLoading(true)
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/company/admin/dgft/get-count-of-unfetched-dgft-shipping-bills`,
        {
          method: 'GET',
          credentials: 'include',
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(
          data?.detail || data?.message || `Failed to load unfetched DGFT count (${res.status})`,
        )
      }
      setUnfetchedCount(normalizeUnfetchedCountResponse(data))
    } catch (e) {
      setUnfetchedCount(null)
      message.error(e instanceof Error ? e.message : 'Failed to load unfetched DGFT shipping bill count')
    } finally {
      setUnfetchedCountLoading(false)
    }
  }, [BACKEND_URL])

  const fetchDays = useCallback(async () => {
    if (!BACKEND_URL) return
    setDaysLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/dgft/process-days`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load DGFT days (${res.status})`)
      }
      const nextDays = normalizeDaysResponse(data).filter((d) => d && typeof d === 'object')
      setDays(nextDays)
      setSelectedDayKey((prev) => {
        if (!nextDays.length) return null
        const keep = prev && nextDays.some((d) => String(d.dayKey ?? d.id) === String(prev))
        if (keep) return prev
        return String(nextDays[0].dayKey ?? nextDays[0].id)
      })
      if (!nextDays.length) {
        setRecords([])
        setSelectedId(null)
        setDetail(null)
        setDetailRows([])
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load DGFT days')
      setDays([])
    } finally {
      setDaysLoading(false)
    }
  }, [BACKEND_URL])

  const fetchDayDetail = useCallback(
    async (dayKey) => {
      if (!BACKEND_URL || !dayKey) return
      setRecordsLoading(true)
      setSelectedId(null)
      setDetail(null)
      setDetailRows([])
      try {
        const params = new URLSearchParams({ id: String(dayKey) })
        const res = await fetch(
          `${BACKEND_URL}/api/company/admin/dgft/process-day-detail?${params}`,
          { method: 'GET', credentials: 'include' },
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(
            data?.detail || data?.message || `Failed to load DGFT day detail (${res.status})`,
          )
        }
        const rows = normalizeInputsResponse(data).filter((r) => r && typeof r === 'object')
        setRecords(rows)
        if (rows.length) setSelectedId(rows[0].id)
      } catch (e) {
        message.error(e instanceof Error ? e.message : 'Failed to load DGFT day detail')
        setRecords([])
      } finally {
        setRecordsLoading(false)
      }
    },
    [BACKEND_URL],
  )

  const fetchDetail = useCallback(
    async (id) => {
      if (!BACKEND_URL || !id) return
      setDetailLoading(true)
      setDetail(null)
      setDetailRows([])
      try {
        const params = new URLSearchParams({ id: String(id) })
        const res = await fetch(`${BACKEND_URL}/api/company/admin/dgft/process-table-rows?${params}`, {
          method: 'GET',
          credentials: 'include',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(
            data?.detail || data?.message || `Failed to load DGFT table rows for record ${id}`,
          )
        }
        const normalized = normalizeDetailResponse(data)
        setDetail(normalized)
        setDetailRows(mergeDetailRows(normalized))
      } catch (e) {
        message.error(e instanceof Error ? e.message : 'Failed to load DGFT table rows')
      } finally {
        setDetailLoading(false)
      }
    },
    [BACKEND_URL],
  )

  useEffect(() => {
    fetchDays()
    fetchUnfetchedCount()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- initial load only

  useEffect(() => {
    if (selectedDayKey) {
      setSearchMode(false)
      setSearchedSbNos([])
      setNotFoundSbNos([])
      setSearchInput('')
      fetchDayDetail(selectedDayKey)
    } else if (!searchMode) {
      setRecords([])
      setSelectedId(null)
      setDetail(null)
      setDetailRows([])
    }
  }, [selectedDayKey, fetchDayDetail, searchMode])

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId)
  }, [selectedId, fetchDetail])

  const handleProcessRandomTen = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    const size = Math.min(100, Math.max(1, Number(sampleSize) || 10))
    setSubmittingRandomTen(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/dgft/process-random-ten`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sampleSize: size,
          fetchUsing: normalizeFetchUsing(fetchUsing),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || 'DGFT random batch process failed')
      }
      if (data?.success === false) {
        message.warning(data?.message || 'Completed with issues')
      } else {
        message.success(data?.message || `Random DGFT process completed for ${size} shipping bill(s)`)
      }
      await Promise.all([fetchDays(), fetchUnfetchedCount()])
      const dayFromResult =
        data?.data?.dayKey || data?.dayKey || new Date().toISOString().slice(0, 10)
      if (dayFromResult) setSelectedDayKey(String(dayFromResult))
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to run random DGFT batch process')
    } finally {
      setSubmittingRandomTen(false)
    }
  }, [BACKEND_URL, sampleSize, fetchDays, fetchUnfetchedCount, fetchUsing])

  const refreshDaysAndCount = useCallback(async () => {
    await Promise.all([fetchDays(), fetchUnfetchedCount()])
    if (selectedDayKey) await fetchDayDetail(selectedDayKey)
  }, [fetchDays, fetchUnfetchedCount, selectedDayKey, fetchDayDetail])

  const handleExportCurrent = useCallback(() => {
    const rec = records.find((r) => String(r?.id) === String(selectedId))
    if (!rec) {
      message.warning('Select a record first.')
      return
    }
    if (!detailRows.length) {
      message.warning('No table rows to export for this record.')
      return
    }
    try {
      downloadDgftRecordExcel(rec, detailRows)
      message.success('Excel file downloaded.')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Export failed')
    }
  }, [records, selectedId, detailRows])

  const handleExportAll = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    const targets = filteredRecords
    if (!targets.length) {
      message.warning('No records to export.')
      return
    }
    setExportingAll(true)
    const combinedRows = []
    let recordsWithData = 0
    let recordsWithoutData = 0
    let failedFetch = 0
    try {
      for (const rec of targets) {
        try {
          const params = new URLSearchParams({ id: String(rec.id) })
          const res = await fetch(
            `${BACKEND_URL}/api/company/admin/dgft/process-table-rows?${params}`,
            { method: 'GET', credentials: 'include' },
          )
          if (!res.ok) {
            failedFetch++
            combinedRows.push(...buildDgftExcelRows(rec, []))
            continue
          }
          const data = await res.json().catch(() => ({}))
          const normalized = normalizeDetailResponse(data)
          const rows = mergeDetailRows(normalized)
          if (!rows.length) {
            recordsWithoutData++
          } else {
            recordsWithData++
          }
          combinedRows.push(...buildDgftExcelRows(rec, rows))
        } catch {
          failedFetch++
          combinedRows.push(...buildDgftExcelRows(rec, []))
        }
      }
      if (!combinedRows.length) {
        message.warning('No data to export.')
        return
      }
      downloadDgftCombinedExcel(combinedRows)
      const parts = [`${combinedRows.length} row(s) exported`]
      parts.push(`${recordsWithData} record(s) with data`)
      if (recordsWithoutData) parts.push(`${recordsWithoutData} without`)
      if (failedFetch) parts.push(`${failedFetch} failed fetch`)
      message.success(parts.join(' · '))
    } finally {
      setExportingAll(false)
    }
  }, [BACKEND_URL, filteredRecords])

  const dayColumns = useMemo(
    () => [
      {
        title: 'Day',
        dataIndex: 'dayKey',
        key: 'day',
        width: 120,
        ellipsis: true,
        render: (_, record) => String(record?.dayKey ?? record?.id ?? '—'),
      },
      {
        title: 'Total',
        dataIndex: 'totalRows',
        key: 'totalRows',
        width: 80,
        align: 'right',
        render: (v) => (v == null ? '—' : String(v)),
      },
      {
        title: 'Success',
        dataIndex: 'processedSuccess',
        key: 'processedSuccess',
        width: 90,
        align: 'right',
        render: (v) => (v == null ? '—' : String(v)),
      },
      {
        title: 'Error',
        dataIndex: 'processedError',
        key: 'processedError',
        width: 90,
        align: 'right',
        render: (v) => (v == null ? '—' : String(v)),
      },
      {
        title: 'No data',
        dataIndex: 'noDataCount',
        key: 'noDataCount',
        width: 90,
        align: 'right',
        render: (v, record) => String(v ?? record?.skipped ?? '—'),
      },
      {
        title: 'Batches',
        dataIndex: 'batchCount',
        key: 'batchCount',
        width: 90,
        align: 'right',
        render: (v) => (v == null ? '—' : String(v)),
      },
      {
        title: '',
        key: 'view',
        width: 88,
        render: (_, record) => {
          const key = record?.dayKey ?? record?.id
          return (
            <Button
              type="link"
              size="small"
              onClick={() => setSelectedDayKey(key != null ? String(key) : null)}
            >
              Detail
            </Button>
          )
        },
      },
    ],
    [],
  )

  const inputColumns = [
    {
      title: 'Day',
      dataIndex: 'dayKey',
      key: 'dayKey',
      width: 110,
      ellipsis: true,
      render: (v) => (v == null || v === '' ? '—' : String(v)),
    },
    {
      title: 'SB No',
      dataIndex: 'input',
      key: 'sbNo',
      width: 170,
      render: (v) => {
        const inputObj = normalizeInputObject(v)
        return pickInputField(inputObj, ['sbNo', 'sbNumber', 'sb_number'])
      },
    },
    {
      title: 'SB Date',
      dataIndex: 'input',
      key: 'sbDate',
      width: 170,
      render: (v) => {
        const inputObj = normalizeInputObject(v)
        return pickInputField(inputObj, ['sbDate', 'sb_date'])
      },
    },
    {
      title: 'SB Location',
      dataIndex: 'input',
      key: 'sbLocation',
      width: 170,
      render: (v) => {
        const inputObj = normalizeInputObject(v)
        return pickInputField(inputObj, ['sbLocation', 'sb_location', 'port'])
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (v) => <Tag color={statusColor(v)}>{String(v || 'unknown')}</Tag>,
    },
    {
      title: 'Batch',
      dataIndex: 'batchId',
      key: 'batchId',
      width: 140,
      ellipsis: true,
      render: (v) => String(v ?? '—'),
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (v) => fmtDate(v),
    },
  ]

  const openPdfModal = useCallback((url) => {
    setPdfModalUrl(url)
  }, [])

  const handleDownloadPdf = useCallback((url, filename) => {
    downloadPdfFromUrl(url, filename)
  }, [])

  const detailColumns = useMemo(() => buildDetailTableColumns(detailRows), [detailRows])

  const expandedRowRender = useCallback(
    (record) => {
      const brc = record?.[BRC_DETAIL_KEY]
      if (!brc || typeof brc !== 'object') return null
      const pdfUrl = brc.pdfUrl
      const br = brc.brNumber || record?.['Bank Realisation Number']
      const filename = br ? `${String(br).replace(/[/\\?%*:|"<>]/g, '-')}.pdf` : 'ebrc.pdf'
      const entries = Object.entries(brc).filter(([k]) => k !== 'pdfUrl' && k !== 'pdfS3Key')
      return (
        <Space direction="vertical" size="middle" style={{ width: '100%', padding: '8px 0' }}>
          {pdfUrl ? (
            <Space wrap>
              <Button type="primary" size="small" onClick={() => openPdfModal(String(pdfUrl))}>
                View PDF
              </Button>
              <Button size="small" onClick={() => handleDownloadPdf(String(pdfUrl), filename)}>
                Download PDF
              </Button>
            </Space>
          ) : (
            <Text type="secondary">No PDF URL on this BRC detail.</Text>
          )}
          <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 2 }} style={{ marginBottom: 0 }}>
            {entries.map(([k, v]) => (
              <Descriptions.Item key={k} label={k} span={1}>
                {cellText(v)}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Space>
      )
    },
    [openPdfModal, handleDownloadPdf],
  )

  const tableExpandable = useMemo(
    () => ({
      expandedRowRender,
      rowExpandable: (record) => hasBrcDetail(record),
      expandIcon: ({ expanded, onExpand, record }) => {
        if (!hasBrcDetail(record)) {
          return <span style={{ display: 'inline-block', width: 17 }} aria-hidden />
        }
        return (
          <Button
            type="text"
            size="small"
            aria-label={expanded ? 'Collapse BRC detail' : 'Expand BRC detail'}
            icon={expanded ? <MinusOutlined /> : <PlusOutlined />}
            onClick={(e) => onExpand(record, e)}
          />
        )
      },
    }),
    [expandedRowRender],
  )

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <Title level={3} style={{ margin: 0 }}>
                  DGFT Process Records
                </Title>
                <Text type="secondary">
                  Browse DGFT runs day-wise (like Shipping Bill), then open a record to inspect scraped
                  table rows.
                </Text>
                {unfetchedCount?.collections?.length ? (
                  <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                    PDF registry vs successful fetches in {unfetchedCount.collections.join(', ')}
                  </Text>
                ) : null}
              </div>
              <Space wrap>
                <Space align="center" size={8}>
                  <Text type="secondary">Sample size:</Text>
                  <InputNumber
                    min={1}
                    max={100}
                    value={sampleSize}
                    onChange={(value) => setSampleSize(value ?? 10)}
                    style={{ width: 88 }}
                    disabled={daysLoading || recordsLoading || submittingRandomTen}
                  />
                </Space>
                <Space align="center" size={8}>
                  <Text type="secondary">Fetch using:</Text>
                  <Select
                    value={fetchUsing}
                    onChange={setFetchUsing}
                    options={FETCH_USING_OPTIONS}
                    style={{ width: 180 }}
                    disabled={daysLoading || recordsLoading || submittingRandomTen}
                  />
                </Space>
                <Button
                  type="primary"
                  onClick={handleProcessRandomTen}
                  loading={submittingRandomTen}
                  disabled={!BACKEND_URL || daysLoading || recordsLoading}
                >
                  Process random batch
                </Button>
                <Button
                  icon={<DownloadOutlined />}
                  onClick={handleExportAll}
                  loading={exportingAll}
                  disabled={
                    !BACKEND_URL ||
                    daysLoading ||
                    recordsLoading ||
                    submittingRandomTen ||
                    !filteredRecords.length
                  }
                >
                  Export day to Excel
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={refreshDaysAndCount}
                  loading={daysLoading || recordsLoading || unfetchedCountLoading}
                  disabled={
                    !BACKEND_URL ||
                    daysLoading ||
                    recordsLoading ||
                    unfetchedCountLoading ||
                    submittingRandomTen ||
                    exportingAll
                  }
                >
                  Refresh days
                </Button>
              </Space>
            </div>

            {unfetchedCount || unfetchedCountLoading ? (
              <div
                style={{
                  padding: '12px 16px',
                  background:
                    unfetchedCount?.filterDgftSbNoNotFetchedUnique > 0 ||
                    unfetchedCount?.filterDgftSbNofetchederrorUnique > 0
                      ? '#fffbe6'
                      : '#f6ffed',
                  border: `1px solid ${
                    unfetchedCount?.filterDgftSbNoNotFetchedUnique > 0 ||
                    unfetchedCount?.filterDgftSbNofetchederrorUnique > 0
                      ? '#ffe58f'
                      : '#b7eb8f'
                  }`,
                  borderRadius: 8,
                }}
              >
                <Space wrap size={[8, 8]}>
                  <Tag>Total SB No: {unfetchedCount?.totalShippingBillNoUnique ?? '—'}</Tag>
                  <Tag color="green">
                    Fetched success (SB No): {unfetchedCount?.totalFetchedShippingBill ?? '—'}
                  </Tag>
                  <Tag>
                    Filter DGFT SB No: {unfetchedCount?.filterDgftSbNoUnique ?? '—'}
                  </Tag>
                  <Tag color={unfetchedCount?.filterDgftSbNoNotFetchedUnique > 0 ? 'orange' : 'green'}>
                    Total Filter DGFT SB No not fetched: {unfetchedCount?.filterDgftSbNoNotFetchedUnique ?? '—'}
                  </Tag>
                  <Tag color={unfetchedCount?.filterDgftSbNofetchederrorUnique > 0 ? 'orange' : 'green'}>
                    Filter DGFT SB No fetched error: {unfetchedCount?.filterDgftSbNofetchederrorUnique ?? '—'}
                  </Tag>
                  {unfetchedCountLoading ? <Text type="secondary">Updating…</Text> : null}
                </Space>
                {unfetchedCount?.message ? (
                  <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                    {unfetchedCount.message}
                  </Text>
                ) : null}
              </div>
            ) : null}

            <div style={{ minWidth: 0, maxWidth: '100%' }}>
              <Title level={5} style={{ marginTop: 0 }}>
                Search SB No (all company records)
              </Title>
              <Space wrap align="center" style={{ marginBottom: 16 }}>
                <Input.TextArea
                  placeholder="Enter one or more SB Nos (comma / space / newline separated)"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault()
                      applySearch()
                    }
                  }}
                  autoSize={{ minRows: 1, maxRows: 3 }}
                  allowClear
                  style={{ width: 420, maxWidth: '100%' }}
                />
                <Button
                  type="primary"
                  icon={<SearchOutlined />}
                  onClick={applySearch}
                  loading={searchLoading}
                  disabled={!BACKEND_URL || searchLoading}
                >
                  Search
                </Button>
                <Button onClick={clearSearch} disabled={!hasActiveSearch && !searchInput}>
                  Clear
                </Button>
              </Space>
              {searchMode ? (
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Searched {searchedSbNos.length} SB No(s)
                  {searchedSbNos.length ? (
                    <>
                      : <Text code>{searchedSbNos.slice(0, 8).join(', ')}</Text>
                      {searchedSbNos.length > 8 ? '…' : ''}
                    </>
                  ) : null}
                  {notFoundSbNos.length ? (
                    <>
                      {' · '}Not found: <Text code>{notFoundSbNos.slice(0, 8).join(', ')}</Text>
                      {notFoundSbNos.length > 8 ? '…' : ''}
                    </>
                  ) : null}
                </Text>
              ) : null}
            </div>

            <div style={{ minWidth: 0, maxWidth: '100%', overflowX: 'auto' }}>
              <Title level={5} style={{ marginTop: 0 }}>
                Days
              </Title>
              <Table
                rowKey={(r) => String(r?.dayKey ?? r?.id ?? Math.random())}
                dataSource={days}
                columns={dayColumns}
                loading={daysLoading}
                pagination={{ pageSize: 10 }}
                scroll={{ x: 720 }}
                onRow={(record) => ({
                  onClick: () => {
                    const key = record?.dayKey ?? record?.id
                    if (key != null) setSelectedDayKey(String(key))
                  },
                  style: { cursor: 'pointer' },
                })}
                rowClassName={(record) =>
                  String(record?.dayKey ?? record?.id) === String(selectedDayKey)
                    ? 'ant-table-row-selected'
                    : ''
                }
                locale={{ emptyText: daysLoading ? 'Loading…' : 'No DGFT days yet' }}
              />
            </div>

            <div style={{ minWidth: 0, maxWidth: '100%', overflowX: 'auto' }}>
              <Title level={5} style={{ marginTop: 0 }}>
                {searchMode
                  ? `Search results (${filteredRecords.length})`
                  : `Inputs ${selectedDayKey ? `(${selectedDayKey})` : ''}`}
              </Title>
              <Table
                rowKey={(r) => String(r?.id ?? Math.random())}
                dataSource={filteredRecords}
                columns={inputColumns}
                loading={recordsLoading || searchLoading}
                pagination={{ pageSize: 10 }}
                scroll={{ x: 980 }}
                onRow={(record) => ({
                  onClick: () => setSelectedId(record?.id ?? null),
                  style: { cursor: 'pointer' },
                })}
                rowClassName={(record) =>
                  String(record?.id) === String(selectedId) ? 'ant-table-row-selected' : ''
                }
                locale={{
                  emptyText: searchMode
                    ? searchLoading
                      ? 'Searching…'
                      : 'No records match the SB No search'
                    : !selectedDayKey
                      ? 'Select a day above or search by SB No'
                      : recordsLoading
                        ? 'Loading…'
                        : 'No records for this day',
                }}
              />
            </div>

            <div style={{ minWidth: 0, maxWidth: '100%', overflowX: 'auto' }}>
              <Space
                align="center"
                wrap
                style={{ width: '100%', justifyContent: 'space-between', marginTop: 0 }}
              >
                <Title level={5} style={{ margin: 0 }}>
                  Table Rows {selectedId ? `(Record ${selectedId})` : ''}
                </Title>
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={handleExportCurrent}
                  disabled={!selectedId || detailLoading || !detailRows.length || exportingAll}
                >
                  Export to Excel
                </Button>
              </Space>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                {detail ? (
                  <Text type="secondary">
                    Status: <Tag color={statusColor(detail?.status)}>{String(detail?.status || 'unknown')}</Tag>{' '}
                    Batch: {String(detail?.batchId ?? '—')} | Day: {String(detail?.dayKey ?? '—')}
                  </Text>
                ) : null}
                <Table
                  rowKey={(row, idx) => {
                    const bn = row?.['Bank Realisation Number']
                    const bill = row?.['Bill ID']
                    if (bn && bill) return `${bn}:${bill}:${idx}`
                    if (row?.id != null) return String(row.id)
                    return `dgft-tr-${idx}`
                  }}
                  dataSource={detailRows}
                  columns={detailColumns}
                  loading={detailLoading}
                  pagination={{ pageSize: 20 }}
                  scroll={{ x: Math.max(900, detailColumns.length * 160) }}
                  expandable={tableExpandable}
                  locale={{ emptyText: selectedId ? 'No table rows found.' : 'Select a record above.' }}
                />
              </Space>
            </div>
          </Space>
        

      <Modal
        title="PDF preview"
        open={Boolean(pdfModalUrl)}
        onCancel={() => setPdfModalUrl(null)}
        footer={null}
        width="min(960px, 92vw)"
        styles={{ body: { padding: 0, height: 'min(82vh, 720px)' } }}
        destroyOnHidden
      >
        {pdfModalUrl ? (
          <iframe
            title="eBRC PDF"
            src={pdfModalUrl}
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          />
        ) : null}
      </Modal>

    </AppShell>
  )
}
