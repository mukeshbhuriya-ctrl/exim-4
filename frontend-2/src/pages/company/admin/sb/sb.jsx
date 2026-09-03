import { DownloadOutlined, ReloadOutlined, SearchOutlined, RightOutlined, DownOutlined } from '@ant-design/icons'
import { Button, Input, Layout, Select, Space, Switch, Table, Tag, Typography, message, Drawer, Tabs } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import ProDataTable from '../../../../components/shared/ProDataTable.jsx'

const { Content } = Layout
const { Title, Text } = Typography

function normalizeList(value) {
  if (value == null) return []
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'object') return [value]
  return []
}

function normalizeDaysFromResponse(data) {
  if (!data || typeof data !== 'object') return []
  if (Array.isArray(data.days)) return data.days
  if (Array.isArray(data.data)) return data.data
  if (Array.isArray(data.batches)) return data.batches
  if (Array.isArray(data)) return data
  return []
}

function normalizeDetailRowsFromResponse(data) {
  if (!data || typeof data !== 'object') return []
  if (Array.isArray(data.rows)) return data.rows
  if (Array.isArray(data.data)) return data.data
  if (Array.isArray(data.results)) return data.results
  if (Array.isArray(data)) return data
  return []
}

function dayRowKey(day, index) {
  if (!day || typeof day !== 'object') return `day-${index}`
  return String(day.id ?? day.dayKey ?? index)
}

function isSuccessDetailRow(row) {
  return String(row?.status ?? '').toLowerCase() === 'success'
}

function isErrorDetailRow(row) {
  return String(row?.status ?? '').toLowerCase() === 'error'
}

function rowsForExcelFromObjects(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return []
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return { value: String(row ?? '') }
    const out = {}
    for (const [k, v] of Object.entries(row)) {
      if (v == null) out[k] = ''
      else if (typeof v === 'object') {
        try {
          out[k] = JSON.stringify(v)
        } catch {
          out[k] = ''
        }
      } else out[k] = v
    }
    return out
  })
}

function safeExcelSheetName(name) {
  const cleaned = String(name).replace(/[:\\/?*[\]]/g, '-').trim()
  return (cleaned || 'Sheet').slice(0, 31)
}

function sheetFromRowsOrEmpty(rows, emptyLabel) {
  const flat = rowsForExcelFromObjects(rows)
  if (!flat.length) {
    return XLSX.utils.aoa_to_sheet([[emptyLabel || '(No rows)']])
  }
  return XLSX.utils.json_to_sheet(flat)
}

function appendObjectSheet(wb, title, rows) {
  XLSX.utils.book_append_sheet(wb, sheetFromRowsOrEmpty(rows, '(No rows)'), safeExcelSheetName(title))
}

const FETCH_USING_OPTIONS = [
  { value: 'dricat', label: 'dricat' },
]

function normalizeFetchUsing(value) {
  const v = String(value || '').trim().toLowerCase()
  if (v === 'dricat') return v
  return 'dricat'
}

function normalizeUnfetchedCountResponse(data) {
  if (!data || typeof data !== 'object') return null
  return {
    registeredCount: Number(data.registeredCount) || 0,
    fetchedSuccessCount: Number(data.fetchedSuccessCount) || 0,
    unfetchedCount: Number(data.unfetchedCount) || 0,
    message: data.message ? String(data.message) : '',
    collection: data.collection ? String(data.collection) : '',
  }
}

function sbTripletKey(r) {
  return `${String(r?.sbNo ?? '').trim()}|${String(r?.sbDate ?? '').trim()}|${String(r?.sbLocation ?? '').trim()}`
}

function prefixKeys(obj, prefix) {
  if (!obj || typeof obj !== 'object') return {}
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    out[`${prefix}${k}`] = v
  }
  return out
}

const SECTION_ARRAY_KEYS = [
  'rows',
  'queueRows',
  'egmRows',
  'gatewayExportRows',
  'Shipping Bill Details',
  'Current Status',
  'LEGM Status',
  'Gateway EGM Status Enquiry',
]

function listFromScrape(d, keys) {
  for (const k of keys) {
    const arr = normalizeList(d?.[k])
    if (arr.length) return arr
  }
  return []
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

/**
 * One logical row per SB (sbNo + sbDate + sbLocation): line-item columns + queue + LEGM + gateway on the same row.
 * Multiple commodities (`rows`) → one Excel row each, with the same queue / LEGM / gateway repeated.
 * Duplicate API rows for the same triple are grouped so sections are not repeated as separate rows.
 */
function buildMergedFlatRowsBySb(detailRows, dayKey) {
  const byKey = new Map()
  for (const r of detailRows) {
    const key = sbTripletKey(r)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(r)
  }

  const mergedAllRows = []
  for (const [, records] of byKey) {
    const r0 = records[0]
    const meta = {
      processRowId: records.map((x) => x?.id).filter(Boolean).join('; ') || r0?.id || '',
      dayKey: r0?.dayKey ?? dayKey ?? '',
      batchId: r0?.batchId ?? '',
      sbNo: r0?.sbNo ?? '',
      sbDate: r0?.sbDate ?? '',
      sbLocation: r0?.sbLocation ?? '',
      status: r0?.status ?? '',
      errorMessage: records.map((x) => x?.errorMessage).filter(Boolean).join('; ') || r0?.errorMessage || '',
      inputIndex: r0?.inputIndex ?? '',
      companyId: r0?.companyId ?? '',
      createdAt: r0?.createdAt ?? '',
      updatedAt: r0?.updatedAt ?? '',
    }

    const allLines = []
    let queueFirst = null
    let egmFirst = null
    let gatewayFirst = null
    let topScrape = {}

    for (const r of records) {
      const d = r?.scrapedData && typeof r.scrapedData === 'object' ? r.scrapedData : {}
      allLines.push(...listFromScrape(d, ['rows', 'Shipping Bill Details']))
      if (queueFirst == null) {
        const q = listFromScrape(d, ['queueRows', 'Current Status'])
        if (q.length) queueFirst = q[0]
      }
      if (egmFirst == null) {
        const e = listFromScrape(d, ['egmRows', 'LEGM Status'])
        if (e.length) egmFirst = e[0]
      }
      if (gatewayFirst == null) {
        const g = listFromScrape(d, ['gatewayExportRows', 'Gateway EGM Status Enquiry'])
        if (g.length) gatewayFirst = g[0]
      }
      if (Object.keys(topScrape).length === 0) {
        topScrape = {
          scrapeOk: d.ok ?? '',
          sbDateNormalized: d.sbDateNormalized ?? '',
        }
        for (const [k, v] of Object.entries(d)) {
          if (SECTION_ARRAY_KEYS.includes(k) || k === 'ok' || k === 'sbDateNormalized') continue
          if (v != null && typeof v !== 'object') topScrape[`scrape_${k}`] = v
        }
      }
    }

    const queueFlat = prefixKeys(queueFirst && typeof queueFirst === 'object' ? queueFirst : {}, 'queue_')
    const legmFlat = prefixKeys(egmFirst && typeof egmFirst === 'object' ? egmFirst : {}, 'legm_')
    const gatewayFlat = prefixKeys(
      gatewayFirst && typeof gatewayFirst === 'object' ? gatewayFirst : {},
      'gateway_',
    )

    const oneRowBase = { ...meta, ...topScrape, ...queueFlat, ...legmFlat, ...gatewayFlat }

    if (allLines.length === 0) {
      mergedAllRows.push(oneRowBase)
      continue
    }

    for (const line of allLines) {
      const lineObj = line && typeof line === 'object' ? line : { line: String(line ?? '') }
      mergedAllRows.push({
        ...oneRowBase,
        ...prefixKeys(lineObj, 'line_'),
      })
    }
  }

  return mergedAllRows
}

function downloadSbDayExcel(detailRows, dayKey, errorRows = []) {
  const combined = [...(Array.isArray(detailRows) ? detailRows : []), ...(Array.isArray(errorRows) ? errorRows : [])]
  const mergedAllRows = buildMergedFlatRowsBySb(combined, dayKey)
  const wb = XLSX.utils.book_new()
  appendObjectSheet(wb, 'Data', mergedAllRows)
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const dk = String(dayKey || 'day').replace(/[^0-9a-zA-Z-]/g, '_')
  XLSX.writeFile(wb, `sb-process-${dk}-${stamp}.xlsx`)
}

export default function CompanyAdminSbPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [dates, setDates] = useState([])
  const [datesLoading, setDatesLoading] = useState(false)
  const [selectedDayKey, setSelectedDayKey] = useState(null)

  const [detailRows, setDetailRows] = useState([])
  const [detailErrorRows, setDetailErrorRows] = useState([])
  const [detailTotalCount, setDetailTotalCount] = useState(0)
  const [detailLoading, setDetailLoading] = useState(false)

  const [onlyUnprocessed, setOnlyUnprocessed] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submittingRandomTen, setSubmittingRandomTen] = useState(false)
  const [lastPost, setLastPost] = useState(null)
  const [fetchUsing, setFetchUsing] = useState('selenium')

  const [unfetchedCount, setUnfetchedCount] = useState(null)
  const [unfetchedCountLoading, setUnfetchedCountLoading] = useState(false)

  const [searchInput, setSearchInput] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchMode, setSearchMode] = useState(false)
  const [searchedSbNos, setSearchedSbNos] = useState([])
  const [notFoundSbNos, setNotFoundSbNos] = useState([])

  const clearSearch = useCallback(() => {
    setSearchInput('')
    setSearchMode(false)
    setSearchedSbNos([])
    setNotFoundSbNos([])
    if (!selectedDayKey) {
      setDetailRows([])
      setDetailErrorRows([])
      setDetailTotalCount(0)
    }
  }, [selectedDayKey])

  const [refreshDaysKey, setRefreshDaysKey] = useState(0)

  const fetchDaysGrid = useCallback(async () => {
    if (!BACKEND_URL) return { data: [], meta: { total: 0 } }
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/sb/process-shipping-bill-dates`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.detail || data?.message || `Failed to load SB process dates (${res.status})`)
      const list = normalizeDaysFromResponse(data).filter((d) => d && typeof d === 'object')
      setDates(list)
      return { data: list, meta: { total: list.length } }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load SB process dates')
      setDates([])
      return { data: [], meta: { total: 0 } }
    }
  }, [BACKEND_URL])

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
      const res = await fetch(`${BACKEND_URL}/api/company/admin/sb/search-by-sb-no`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sbNos }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Search failed (${res.status})`)
      }
      const rows = normalizeDetailRowsFromResponse(data).filter((r) => r && typeof r === 'object')
      setSelectedDayKey(null)
      setSearchMode(true)
      setSearchedSbNos(Array.isArray(data?.searchedSbNos) ? data.searchedSbNos : sbNos)
      setNotFoundSbNos(Array.isArray(data?.notFoundSbNos) ? data.notFoundSbNos : [])
      setDetailTotalCount(rows.length)
      setDetailRows(rows.filter(isSuccessDetailRow))
      setDetailErrorRows(rows.filter(isErrorDetailRow))
      if (!rows.length) {
        message.info('No shipping bill records found for the given SB No(s).')
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to search shipping bills')
    } finally {
      setSearchLoading(false)
    }
  }, [BACKEND_URL, searchInput])

  const hasActiveSearch = searchMode

  const filteredDetailRows = detailRows
  const filteredDetailErrorRows = detailErrorRows

  const fetchUnfetchedCount = useCallback(async () => {
    if (!BACKEND_URL) return
    setUnfetchedCountLoading(true)
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/company/admin/sb/get-count-of-unfetched-shipping-bills`,
        {
          method: 'GET',
          credentials: 'include',
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(
          data?.detail || data?.message || `Failed to load unfetched SB count (${res.status})`,
        )
      }
      setUnfetchedCount(normalizeUnfetchedCountResponse(data))
    } catch (e) {
      setUnfetchedCount(null)
      message.error(e instanceof Error ? e.message : 'Failed to load unfetched shipping bill count')
    } finally {
      setUnfetchedCountLoading(false)
    }
  }, [BACKEND_URL])

  const fetchProcessDates = useCallback(async () => {
    if (!BACKEND_URL) return
    setDatesLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/sb/process-shipping-bill-dates`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load SB process dates (${res.status})`)
      }
      const list = normalizeDaysFromResponse(data).filter((d) => d && typeof d === 'object')
      setDates(list)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load SB process dates')
      setDates([])
    } finally {
      setDatesLoading(false)
    }
  }, [BACKEND_URL])

  const fetchDayDetail = useCallback(
    async (dayKey) => {
      if (!BACKEND_URL || !dayKey) return
      setDetailLoading(true)
      setDetailRows([])
      setDetailErrorRows([])
      setDetailTotalCount(0)
      try {
        const params = new URLSearchParams({ id: String(dayKey) })
        const res = await fetch(
          `${BACKEND_URL}/api/company/admin/sb/process-shipping-bill-date-wise-detail?${params}`,
          {
            method: 'GET',
            credentials: 'include',
          },
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.detail || data?.message || `Failed to load day detail (${res.status})`)
        }
        const rows = normalizeDetailRowsFromResponse(data).filter((r) => r && typeof r === 'object')
        setDetailTotalCount(rows.length)
        setDetailRows(rows.filter(isSuccessDetailRow))
        setDetailErrorRows(rows.filter(isErrorDetailRow))
      } catch (e) {
        message.error(e instanceof Error ? e.message : 'Failed to load day detail')
        setDetailRows([])
        setDetailErrorRows([])
        setDetailTotalCount(0)
      } finally {
        setDetailLoading(false)
      }
    },
    [BACKEND_URL],
  )

  useEffect(() => {
    fetchProcessDates()
    fetchUnfetchedCount()
  }, [fetchProcessDates, fetchUnfetchedCount])

  useEffect(() => {
    if (selectedDayKey) {
      setSearchMode(false)
      setSearchedSbNos([])
      setNotFoundSbNos([])
      setSearchInput('')
      fetchDayDetail(selectedDayKey)
    } else if (!searchMode) {
      setDetailRows([])
      setDetailErrorRows([])
      setDetailTotalCount(0)
    }
  }, [selectedDayKey, fetchDayDetail, searchMode])

  const successDetailColumns = useMemo(
    () => [
      { title: 'Day', dataIndex: 'dayKey', key: 'dayKey', width: 110, ellipsis: true },
      { title: 'SB No', dataIndex: 'sbNo', key: 'sbNo', ellipsis: true },
      { title: 'SB Date', dataIndex: 'sbDate', key: 'sbDate', ellipsis: true },
      { title: 'SB Location', dataIndex: 'sbLocation', key: 'sbLocation', ellipsis: true },
      { title: 'Status', dataIndex: 'status', key: 'status', width: 88 },
    ],
    [],
  )

  const scrapedSubTableColumns = useMemo(
    () => ({
      rows: [
        { title: 'IEC', dataIndex: 'iec', key: 'iec', ellipsis: true },
        { title: 'CHA No', dataIndex: 'chaNo', key: 'chaNo', ellipsis: true },
        { title: 'Job No', dataIndex: 'jobNo', key: 'jobNo', ellipsis: true },
        { title: 'Job Date', dataIndex: 'jobDate', key: 'jobDate', ellipsis: true },
        { title: 'Port Of Discharge', dataIndex: 'portOfDischarge', key: 'portOfDischarge', ellipsis: true },
        { title: 'Total Package', dataIndex: 'totalPackage', key: 'totalPackage', ellipsis: true },
        { title: 'Gross Weight', dataIndex: 'grossWeight', key: 'grossWeight', ellipsis: true },
        { title: 'FOB', dataIndex: 'fob', key: 'fob', ellipsis: true },
        { title: 'Total Cess', dataIndex: 'totalCess', key: 'totalCess', ellipsis: true },
        { title: 'Drawback', dataIndex: 'drawback', key: 'drawback', ellipsis: true },
        { title: 'STR', dataIndex: 'str', key: 'str', ellipsis: true },
        { title: 'Total', dataIndex: 'total', key: 'total', ellipsis: true },
        { title: 'CIN No', dataIndex: 'cinNo', key: 'cinNo', ellipsis: true },
        { title: 'CIN Date', dataIndex: 'cinDate', key: 'cinDate', ellipsis: true },
        { title: 'Reward Flag', dataIndex: 'rewardFlag', key: 'rewardFlag', ellipsis: true },
      ],
      queueRows: [
        { title: 'Curr Queue', dataIndex: 'currQueue', key: 'currQueue', ellipsis: true },
        { title: 'LEO Date', dataIndex: 'leoDate', key: 'leoDate', ellipsis: true },
        { title: 'EP Copy', dataIndex: 'epCopy', key: 'epCopy', ellipsis: true },
        { title: 'Cust Scroll No', dataIndex: 'custScrollNo', key: 'custScrollNo', ellipsis: true },
        { title: 'Scroll Date', dataIndex: 'scrollDate', key: 'scrollDate', ellipsis: true },
        { title: 'EGM Filed', dataIndex: 'egmFiled', key: 'egmFiled', ellipsis: true },
      ],
      egmRows: [
        { title: 'EGM No', dataIndex: 'egmNo', key: 'egmNo', ellipsis: true },
        { title: 'EGM Date', dataIndex: 'egmDate', key: 'egmDate', ellipsis: true },
        { title: 'Container No', dataIndex: 'containerNo', key: 'containerNo', ellipsis: true },
        { title: 'Seal No', dataIndex: 'sealNo', key: 'sealNo', ellipsis: true },
        { title: 'Error Msg', dataIndex: 'errorMsg', key: 'errorMsg', ellipsis: true },
      ],
      gatewayExportRows: [
        { title: 'AWB No', dataIndex: 'awbNo', key: 'awbNo', ellipsis: true },
        { title: 'Cust Gateway Port', dataIndex: 'custGatewayPort', key: 'custGatewayPort', ellipsis: true },
        { title: 'Cust Gateway EGM No', dataIndex: 'custGatewayEgmNo', key: 'custGatewayEgmNo', ellipsis: true },
        { title: 'Cust Gateway EGM Date', dataIndex: 'custGatewayEgmDate', key: 'custGatewayEgmDate', ellipsis: true },
        { title: 'Gateway Site Id', dataIndex: 'gatewaySiteId', key: 'gatewaySiteId', ellipsis: true },
        { title: 'Error Code', dataIndex: 'errorCode', key: 'errorCode', ellipsis: true },
      ],
    }),
    [],
  )

  const scrapedExpandable = useMemo(
    () => ({
      expandedRowRender: (record) => {
        const d = record?.scrapedData && typeof record.scrapedData === 'object' ? record.scrapedData : {}
        const sections = [
          {
            key: 'rows',
            title: 'Shipping Bill Details',
            data: normalizeList(d?.['Shipping Bill Details'] ?? d?.rows),
            columns: scrapedSubTableColumns.rows,
          },
          {
            key: 'queueRows',
            title: 'Current Status',
            data: normalizeList(d?.['Current Status'] ?? d?.queueRows),
            columns: scrapedSubTableColumns.queueRows,
          },
          {
            key: 'egmRows',
            title: 'LEGM Status',
            data: normalizeList(d?.['LEGM Status'] ?? d?.egmRows),
            columns: scrapedSubTableColumns.egmRows,
          },
          {
            key: 'gatewayExportRows',
            title: 'Gateway EGM Status Enquiry',
            data: normalizeList(d?.['Gateway EGM Status Enquiry'] ?? d?.gatewayExportRows),
            columns: scrapedSubTableColumns.gatewayExportRows,
          },
        ]
        return (
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            {record?.errorMessage ? (
              <Text type="secondary">Stored errorMessage: {String(record.errorMessage) || '—'}</Text>
            ) : null}
            {sections.map((s) => (
              <div key={s.key} style={{ width: '100%' }}>
                <Text strong>
                  {s.title} ({s.data.length})
                </Text>
                <Table
                  size="small"
                  style={{ marginTop: 8 }}
                  rowKey={(_, idx) => `${record?.id ?? 'r'}-${s.key}-${idx}`}
                  columns={s.columns}
                  dataSource={s.data}
                  pagination={false}
                  locale={{ emptyText: 'No data' }}
                  scroll={{ x: 'max-content' }}
                />
              </div>
            ))}
          </Space>
        )
      },
      rowExpandable: () => true,
      expandIcon: ({ expanded, onExpand, record }) =>
        expanded ? (
          <DownOutlined style={{ fontSize: 12, cursor: 'pointer', color: 'var(--exim-gray-600)', margin: '0 8px' }} onClick={e => onExpand(record, e)} />
        ) : (
          <RightOutlined style={{ fontSize: 12, cursor: 'pointer', color: 'var(--exim-gray-600)', margin: '0 8px' }} onClick={e => onExpand(record, e)} />
        ),
    }),
    [scrapedSubTableColumns],
  )

  const errorDetailColumns = useMemo(
    () => [
      { title: 'Day', dataIndex: 'dayKey', key: 'dayKey', width: 110, ellipsis: true },
      { title: 'SB No', dataIndex: 'sbNo', key: 'sbNo', ellipsis: true },
      { title: 'SB Date', dataIndex: 'sbDate', key: 'sbDate', ellipsis: true },
      { title: 'SB Location', dataIndex: 'sbLocation', key: 'sbLocation', ellipsis: true },
      { title: 'Status', dataIndex: 'status', key: 'status', width: 80 },
      {
        title: 'Error message',
        dataIndex: 'errorMessage',
        key: 'errorMessage',
        ellipsis: true,
        render: (v) => (v == null || v === '' ? '—' : String(v)),
      },
    ],
    [],
  )

  const datesColumns = useMemo(
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
        title: 'Skipped',
        dataIndex: 'skipped',
        key: 'skipped',
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
            <Button type="link" size="small" onClick={() => setSelectedDayKey(key != null ? String(key) : null)}>
              Detail
            </Button>
          )
        },
      },
    ],
    [],
  )

  const handleRunProcess = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    setSubmitting(true)
    setLastPost(null)
    try {
      const body = {
        data: [],
        fetchUsing: normalizeFetchUsing(fetchUsing),
        ...(onlyUnprocessed ? { onlyUnprocessed: true, onlyPending: true } : {}),
      }
      const res = await fetch(`${BACKEND_URL}/api/company/admin/sb/process-shipping-bill`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      setLastPost(data)
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || 'Process shipping bill failed')
      }
      if (data?.success === false) {
        message.warning(data?.message || 'Completed with issues')
      } else {
        message.success(data?.message || 'Shipping bill process started or completed')
      }
      await fetchUnfetchedCount()
      setRefreshDaysKey((prev) => prev + 1)
      const dk = data?.dayKey ?? data?.data?.dayKey
      if (dk != null) {
        setSelectedDayKey(String(dk))
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to run process')
    } finally {
      setSubmitting(false)
    }
  }

  const handleProcessRandomTen = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    setSubmittingRandomTen(true)
    setLastPost(null)
    try {
      const body = {
        data: [],
        fetchUsing: normalizeFetchUsing(fetchUsing),
        ...(onlyUnprocessed ? { onlyUnprocessed: true, onlyPending: true } : {}),
      }
      const res = await fetch(`${BACKEND_URL}/api/company/admin/sb/process-random-ten-shipping-bills`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      setLastPost(data)
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || 'Process random 10 shipping bills failed')
      }
      if (data?.success === false) {
        message.warning(data?.message || 'Completed with issues')
      } else {
        message.success(data?.message || 'Random 10 shipping bills processed')
      }
      await fetchUnfetchedCount()
      setRefreshDaysKey((prev) => prev + 1)
      const dk = data?.dayKey ?? data?.data?.dayKey
      if (dk != null) {
        setSelectedDayKey(String(dk))
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to process random 10')
    } finally {
      setSubmittingRandomTen(false)
    }
  }

  const refreshDaysAndCount = useCallback(async () => {
    await fetchUnfetchedCount()
    setRefreshDaysKey((prev) => prev + 1)
  }, [fetchUnfetchedCount])

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="large" style={{ width: '100%', maxWidth: '100%' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                background: unfetchedCount?.unfetchedCount > 0 ? '#fffbe6' : '#f6ffed',
                border: `1px solid ${unfetchedCount?.unfetchedCount > 0 ? '#ffe58f' : '#b7eb8f'}`,
                borderRadius: 8,
                flexWrap: 'wrap',
                gap: 16
              }}
            >
              <div>
                <Title level={5} style={{ margin: 0 }}>Shipping Bill Process</Title>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {unfetchedCount
                    ? `PDF registry vs successful fetches in ${unfetchedCount.collection || 'sbonline'}`
                    : 'Manage shipping bill fetching operations'}
                  {unfetchedCount?.message ? ` — ${unfetchedCount.message}` : ''}
                </Text>
              </div>

              {(unfetchedCount || unfetchedCountLoading) && (
                <Space wrap size={[8, 8]}>
                  <Tag>Registered: {unfetchedCount?.registeredCount ?? '—'}</Tag>
                  <Tag color="green">Fetched (success): {unfetchedCount?.fetchedSuccessCount ?? '—'}</Tag>
                  <Tag color={unfetchedCount?.unfetchedCount > 0 ? 'orange' : 'green'}>
                    Unfetched: {unfetchedCount?.unfetchedCount ?? '—'}
                  </Tag>
                  {unfetchedCountLoading ? <Text type="secondary" style={{ fontSize: 12 }}>Updating…</Text> : null}
                </Space>
              )}
            </div>

            <div style={{ width: '100%', minWidth: 0 }}>
              <ProDataTable
                columns={datesColumns}
                fetchData={fetchDaysGrid}
                refreshKey={refreshDaysKey}
                rowKey={(record, index) => dayRowKey(record, index)}
                globalSearchPlaceholder="Search process days..."
                showSelectionColumn={false}
                customToolbarActions={
                  <Space size={12} align="center">
                    <Input.Search
                      placeholder="Search SB No (comma/space separated)"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      onSearch={applySearch}
                      enterButton="Search"
                      loading={searchLoading}
                      disabled={!BACKEND_URL}
                      style={{ width: 280 }}
                      allowClear
                      onClear={clearSearch}
                    />
                    <Button onClick={clearSearch} disabled={!hasActiveSearch && !searchInput}>
                      Clear Search
                    </Button>
                    <Button
                      icon={<ReloadOutlined />}
                      onClick={refreshDaysAndCount}
                      loading={unfetchedCountLoading}
                      disabled={!BACKEND_URL || unfetchedCountLoading || submitting || submittingRandomTen}
                    >
                      Refresh days
                    </Button>
                    <Button
                      type="primary"
                      onClick={handleRunProcess}
                      loading={submitting}
                      disabled={!BACKEND_URL || submitting || submittingRandomTen}
                    >
                      Process shipping bill
                    </Button>
                    <Button
                      onClick={handleProcessRandomTen}
                      loading={submittingRandomTen}
                      disabled={!BACKEND_URL || submitting || submittingRandomTen}
                    >
                      Process random 10
                    </Button>
                  </Space>
                }
              />
            </div>

            <Drawer
              title={
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>
                    {searchMode ? 'Search Results' : `Process Day Detail`}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--exim-gray-500)', marginTop: 4 }}>
                    {searchMode ? (
                      <>
                        Searched {searchedSbNos.length} SB No(s)
                        {notFoundSbNos.length ? ` · Not found: ${notFoundSbNos.slice(0, 5).join(', ')}${notFoundSbNos.length > 5 ? '…' : ''}` : ''}
                      </>
                    ) : (
                      `Date Key: ${selectedDayKey}`
                    )}
                  </span>
                </div>
              }
              placement="right"
              width="85%"
              onClose={() => {
                if (searchMode) clearSearch()
                else setSelectedDayKey(null)
              }}
              open={!!selectedDayKey || searchMode}
              extra={
                <Space>
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    onClick={() => {
                      if (!detailRows.length && !detailErrorRows.length) {
                        message.warning('No rows to export.')
                        return
                      }
                      try {
                        downloadSbDayExcel(
                          detailRows,
                          searchMode ? 'search' : selectedDayKey,
                          detailErrorRows,
                        )
                        message.success('Excel file downloaded.')
                      } catch (e) {
                        message.error(e instanceof Error ? e.message : 'Export failed')
                      }
                    }}
                    disabled={detailLoading || searchLoading || (!detailRows.length && !detailErrorRows.length)}
                  >
                    Export to Excel
                  </Button>
                </Space>
              }
              styles={{
                header: { padding: '16px 24px', borderBottom: '1px solid var(--exim-border-light)' },
                body: { padding: '0px', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--exim-gray-50)' },
              }}
            >
              <div style={{ padding: '0 24px', backgroundColor: 'white', borderBottom: '1px solid var(--exim-border-light)', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <Tabs
                  defaultActiveKey="success"
                  style={{ height: '100%' }}
                  items={[
                    {
                      key: 'success',
                      label: (
                        <span>
                          Success <Tag color="green" style={{ marginLeft: 8 }}>{filteredDetailRows.length}</Tag>
                        </span>
                      ),
                      children: (
                        <div style={{ 
                          background: 'white', 
                          padding: 16, 
                          borderRadius: 8, 
                          border: '1px solid var(--exim-border-light)',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                          marginTop: 16
                        }}>
                          <Table
                            size="small"
                            loading={detailLoading || searchLoading}
                            rowKey={(r) => String(r?.id ?? r?._id ?? `${selectedDayKey || 'search'}-${r?.sbNo}-${r?.inputIndex}`)}
                            columns={successDetailColumns}
                            dataSource={filteredDetailRows}
                            pagination={{ pageSize: 25, showSizeChanger: true }}
                            locale={{ emptyText: 'No rows found.' }}
                            scroll={{ x: 'max-content', y: 'calc(100vh - 280px)' }}
                            sticky
                            expandable={scrapedExpandable}
                            className="custom-table"
                          />
                        </div>
                      )
                    },
                    {
                      key: 'error',
                      label: (
                        <span>
                          Error <Tag color="error" style={{ marginLeft: 8 }}>{filteredDetailErrorRows.length}</Tag>
                        </span>
                      ),
                      children: (
                        <div style={{ 
                          background: 'white', 
                          padding: 16, 
                          borderRadius: 8, 
                          border: '1px solid var(--exim-border-light)',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                          marginTop: 16
                        }}>
                          <Table
                            size="small"
                            loading={detailLoading || searchLoading}
                            rowKey={(r) => String(r?.id ?? r?._id ?? `err-${selectedDayKey || 'search'}-${r?.sbNo}-${r?.inputIndex}`)}
                            columns={errorDetailColumns}
                            dataSource={filteredDetailErrorRows}
                            pagination={{ pageSize: 25, showSizeChanger: true }}
                            locale={{ emptyText: 'No error rows found.' }}
                            scroll={{ x: 'max-content', y: 'calc(100vh - 280px)' }}
                            sticky
                            expandable={scrapedExpandable}
                            className="custom-table"
                          />
                        </div>
                      )
                    }
                  ]}
                />
              </div>
            </Drawer>
          </Space>
        </AppShell>
  )
}
