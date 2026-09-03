import { DownloadOutlined } from '@ant-design/icons'
import { Button, Input, Layout, Select, Space, Typography, message, DatePicker } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'
import ProDataTable from '../../../../components/shared/ProDataTable.jsx'

dayjs.extend(isBetween)

const { Content } = Layout
const { Title, Text } = Typography

const MONTH_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

const MONTH_SELECT_OPTIONS = MONTH_LABELS.map((m) => ({ label: m, value: m }))

const YEARS_BACK = 5

function buildYearOptions(yearsBack = YEARS_BACK) {
  const nowYear = new Date().getFullYear()
  const options = []
  for (let y = nowYear; y > nowYear - yearsBack; y--) {
    options.push({ label: String(y), value: y })
  }
  return options
}

function composeSbMonthAndYear(monthAbbr, year) {
  const m = String(monthAbbr ?? '').trim().toUpperCase()
  const y = year != null && year !== '' ? Number(year) : NaN
  if (!m || !MONTH_LABELS.includes(m) || Number.isNaN(y)) return ''
  return `${m}-${y}`
}

function parseSbMonthAndYear(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return { monthAbbr: undefined, year: undefined }
  const match = raw.match(/^([A-Za-z]{3})-(\d{4})$/i)
  if (!match) return { monthAbbr: undefined, year: undefined }
  const monthAbbr = match[1].toUpperCase()
  if (!MONTH_LABELS.includes(monthAbbr)) return { monthAbbr: undefined, year: undefined }
  return { monthAbbr, year: Number(match[2]) }
}

function currentMonthAbbr() {
  return MONTH_LABELS[new Date().getMonth()]
}

function currentYear() {
  return new Date().getFullYear()
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

function normalizeChaRows(data) {
  if (!data || typeof data !== 'object') return []
  if (Array.isArray(data.rows)) return data.rows.filter((r) => r != null)
  if (Array.isArray(data.data)) return data.data.filter((r) => r != null)
  if (Array.isArray(data)) return data.filter((r) => r != null)
  return []
}

function buildColumnsFromRows(rows) {
  const keys = new Set()
  for (const row of rows) {
    if (row && typeof row === 'object') {
      Object.keys(row).forEach((k) => keys.add(k))
    }
  }
  const ordered = Array.from(keys).sort((a, b) => {
    const priority = ['sbNo', 'sbDt', 'gstin', 'fetchdate', 'companyId', '_id']
    const ia = priority.indexOf(a)
    const ib = priority.indexOf(b)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    return a.localeCompare(b)
  })
  return ordered.map((k) => ({
    title: k,
    dataIndex: k,
    key: k,
    ellipsis: true,
    width: k === '_id' ? 220 : undefined,
    render: (v) => cellText(v),
  }))
}

function rowsForExcel(rows) {
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

function downloadChaDataExcel(rows, meta) {
  const flat = rowsForExcel(rows)
  const wb = XLSX.utils.book_new()
  const ws =
    flat.length > 0
      ? XLSX.utils.json_to_sheet(flat)
      : XLSX.utils.aoa_to_sheet([['(No rows)']])
  XLSX.utils.book_append_sheet(wb, ws, 'CHA data')
  const monthPart = String(meta?.sbMonthAndYear || 'export').replace(/[^0-9a-zA-Z-]/g, '_')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  XLSX.writeFile(wb, `cha-data-${monthPart}-${stamp}.xlsx`)
}

async function runChaGetProcess(BACKEND_URL, path, { successFallback, query }) {
  const params = new URLSearchParams()
  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && String(v).trim() !== '') params.set(k, String(v).trim())
    }
  }
  const qs = params.toString()
  const url = `${BACKEND_URL}${path}${qs ? `?${qs}` : ''}`
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.detail || data?.message || `Request failed (${res.status})`)
  }
  if (data?.success === false) {
    message.warning(data?.message || 'Process reported incomplete or skipped')
  } else {
    message.success(data?.message || successFallback)
  }
}

export default function CompanyAdminChaPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')
  const [loadingWithOtp, setLoadingWithOtp] = useState(false)
  const [loadingWithoutOtp, setLoadingWithoutOtp] = useState(false)
  const [processMonthAbbr, setProcessMonthAbbr] = useState(() => currentMonthAbbr())
  const [processYear, setProcessYear] = useState(() => currentYear())
  const [processWithoutOtpSectionIndex, setProcessWithoutOtpSectionIndex] = useState('')

  const yearOptions = useMemo(() => buildYearOptions(YEARS_BACK), [])
  const monthYearPeriodTotal = YEARS_BACK * 12

  const [filterMonthAbbr, setFilterMonthAbbr] = useState(undefined)
  const [filterYear, setFilterYear] = useState(undefined)
  
  const [dateRange, setDateRange] = useState([dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')])
  const [filterGstinInput, setFilterGstinInput] = useState('')
  const [filterGstin, setFilterGstin] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const [chaDataLoading, setChaDataLoading] = useState(false)
  const [mergingToSales, setMergingToSales] = useState(false)
  const [chaDataMeta, setChaDataMeta] = useState(null)
  const [chaDataRows, setChaDataRows] = useState([])
  
  const chaDataColumns = useMemo(() => buildColumnsFromRows(chaDataRows), [chaDataRows])

  const fetchDataForGrid = useCallback(async (params) => {
    if (!BACKEND_URL) return { data: [], meta: { total: 0 } }
    
    setChaDataLoading(true)
    
    try {
      const qs = new URLSearchParams()
      
      const start = dateRange && dateRange[0] ? dateRange[0] : dayjs().subtract(1, 'month').startOf('month')
      const end = dateRange && dateRange[1] ? dateRange[1] : dayjs().subtract(1, 'month').endOf('month')
      
      const monthStr = start.format('MMM-YYYY').toUpperCase()
      qs.set('month', monthStr)
      
      const gstin = filterGstin.trim()
      if (gstin) qs.set('gstin', gstin)
      
      const url = `${BACKEND_URL}/api/company/admin/cha/get-cha-data${qs.toString() ? `?${qs.toString()}` : ''}`
      const res = await fetch(url, { method: 'GET', credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load CHA data (${res.status})`)
      }
      if (data?.success === false) {
        throw new Error(data?.message || 'Failed to load CHA data')
      }
      
      let rows = normalizeChaRows(data)
      
      // Local date range filter based on sbDt
      if (dateRange && dateRange[0] && dateRange[1]) {
        rows = rows.filter(r => {
           if (!r.sbDt) return true
           const d = dayjs(r.sbDt)
           if (!d.isValid()) return true
           return d.isBetween(start.startOf('day'), end.endOf('day'), null, '[]')
        })
      }
      
      // Local Search filter
      if (params.search) {
        const s = params.search.toLowerCase()
        rows = rows.filter(r => Object.values(r).some(v => String(v || '').toLowerCase().includes(s)))
      }
      
      setChaDataRows(rows)
      
      const metaMonth = data?.sbMonthAndYear ?? monthStr
      setChaDataMeta({
        sbMonthAndYear: metaMonth,
        gstin: data?.gstin ?? null,
        count: rows.length,
      })
      
      // Pagination
      const page = params.page || 1
      const limit = params.limit || 10
      const pagedRows = rows.slice((page - 1) * limit, page * limit)
      
      return { data: pagedRows, meta: { total: rows.length } }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load CHA data')
      setChaDataRows([])
      setChaDataMeta(null)
      return { data: [], meta: { total: 0 } }
    } finally {
      setChaDataLoading(false)
    }
  }, [BACKEND_URL, dateRange, filterGstin])

  const handleStartCurrentMonthProcess = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    setLoadingWithOtp(true)
    try {
      await runChaGetProcess(
        BACKEND_URL,
        '/api/company/admin/cha/start-current-month-process',
        {
          successFallback: 'Current month CHA process started successfully.',
        },
      )
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to start current month process')
    } finally {
      setLoadingWithOtp(false)
    }
  }, [BACKEND_URL])

  const handleStartCurrentMonthProcessWithoutOtp = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    const month = composeSbMonthAndYear(processMonthAbbr, processYear)
    const sectionRaw = processWithoutOtpSectionIndex.trim()
    const query = {}
    if (month) {
      query.sbMonthAndYear = month
      query.month = month
    }
    if (sectionRaw !== '') {
      const sectionIndex = Number(sectionRaw)
      if (Number.isNaN(sectionIndex) || sectionIndex < 0) {
        message.error('Section index must be a non-negative number.')
        return
      }
      query.sectionIndex = String(sectionIndex)
    }
    setLoadingWithoutOtp(true)
    try {
      await runChaGetProcess(
        BACKEND_URL,
        '/api/company/admin/cha/start-current-month-process-without-otp',
        {
          successFallback: 'Current month CHA process (without OTP) started successfully.',
          query: Object.keys(query).length ? query : undefined,
        },
      )
    } catch (e) {
      message.error(
        e instanceof Error ? e.message : 'Failed to start current month process without OTP',
      )
    } finally {
      setLoadingWithoutOtp(false)
    }
  }, [BACKEND_URL, processMonthAbbr, processYear, processWithoutOtpSectionIndex])

  const handleExportChaExcel = useCallback(() => {
    if (!chaDataRows.length) {
      message.warning('No CHA data to export. Load data first.')
      return
    }
    try {
      downloadChaDataExcel(chaDataRows, chaDataMeta)
      message.success('Excel file downloaded.')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Export failed')
    }
  }, [chaDataRows, chaDataMeta])

  const handleMergeChaDataToSales = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    const query = {}
    const month = composeSbMonthAndYear(filterMonthAbbr, filterYear)
    const gstin = filterGstin.trim()
    if (month) {
      query.month = month
      query.sbMonthAndYear = month
    }
    if (gstin) query.gstin = gstin
    setMergingToSales(true)
    try {
      await runChaGetProcess(BACKEND_URL, '/api/company/admin/cha/merge-cha-data-to-sales', {
        successFallback: 'CHA data merged to sales successfully.',
        query: Object.keys(query).length ? query : undefined,
      })
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to merge CHA data to sales')
    } finally {
      setMergingToSales(false)
    }
  }, [BACKEND_URL, filterMonthAbbr, filterYear, filterGstin])

  return (
    <AppShell sidebar={<CompanySidebar />}>
      {/* 
      <Space direction="vertical" size="large" style={{ width: '100%', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            CHA — current month
          </Title>
          <Text type="secondary">
            Run the current-month CHA workflow with or without OTP verification.
          </Text>
        </div>
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Button
            type="primary"
            loading={loadingWithOtp}
            onClick={handleStartCurrentMonthProcess}
            disabled={!BACKEND_URL || loadingWithoutOtp}
          >
            Start current month process
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Without OTP — optional <Text code>sbMonthAndYear</Text>, <Text code>month</Text>, and{' '}
            <Text code>sectionIndex</Text> as query parameters.
          </Text>
          <Space wrap align="center">
            <Select
              placeholder="Month"
              value={processMonthAbbr}
              onChange={setProcessMonthAbbr}
              options={MONTH_SELECT_OPTIONS}
              style={{ width: 100 }}
              disabled={loadingWithoutOtp}
            />
            <Select
              placeholder="Year"
              value={processYear}
              onChange={setProcessYear}
              options={yearOptions}
              style={{ width: 100 }}
              disabled={loadingWithoutOtp}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Total: {monthYearPeriodTotal} periods · last {YEARS_BACK} years
              {composeSbMonthAndYear(processMonthAbbr, processYear) ? (
                <>
                  {' '}
                  → <Text code>{composeSbMonthAndYear(processMonthAbbr, processYear)}</Text>
                </>
              ) : null}
            </Text>
            <Input
              placeholder="sectionIndex (e.g. 0)"
              value={processWithoutOtpSectionIndex}
              onChange={(e) => setProcessWithoutOtpSectionIndex(e.target.value)}
              allowClear
              style={{ width: 160 }}
              disabled={loadingWithoutOtp}
            />
            <Button
              loading={loadingWithoutOtp}
              onClick={handleStartCurrentMonthProcessWithoutOtp}
              disabled={!BACKEND_URL || loadingWithOtp}
            >
              Start current month process (without OTP)
            </Button>
          </Space>
        </Space>
      </Space>
      */}

      <div style={{ width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', flex: 1 }}>
              {chaDataMeta ? (
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Month: <Text code>{chaDataMeta.sbMonthAndYear ?? '—'}</Text>
                  {' · '}
                  GSTIN filter: <Text code>{chaDataMeta.gstin ?? '—'}</Text>
                  {' · '}
                  Count: <Text strong>{chaDataMeta.count ?? chaDataRows.length}</Text>
                </Text>
              ) : null}

              <ProDataTable
                columns={chaDataColumns}
                fetchData={fetchDataForGrid}
                refreshKey={refreshKey}
                globalSearchPlaceholder="Search in fetched rows..."
                rowKey={(r, i) => String(r?._id ?? `cha-row-${i}-${r?.sbNo ?? ''}`)}
                showSelectionColumn={false}
                customToolbarActions={
                  <Space wrap>
                    <DatePicker.RangePicker 
                      value={dateRange}
                      onChange={(dates) => setDateRange(dates)}
                      style={{ width: 260 }}
                    />
                    <Input
                      placeholder="GSTIN (e.g. 24AAFCI...)"
                      value={filterGstinInput}
                      onChange={(e) => setFilterGstinInput(e.target.value)}
                      onPressEnter={() => {
                        setFilterGstin(filterGstinInput)
                        setRefreshKey(prev => prev + 1)
                      }}
                      allowClear
                      style={{ width: 200 }}
                    />
                    <Button type="primary" onClick={() => {
                        setFilterGstin(filterGstinInput)
                        setRefreshKey(prev => prev + 1)
                    }} disabled={chaDataLoading}>
                      Load CHA Data
                    </Button>
                    <Button icon={<DownloadOutlined />} onClick={handleExportChaExcel} disabled={!chaDataRows.length || chaDataLoading}>
                      Export
                    </Button>
                    <Button loading={mergingToSales} onClick={handleMergeChaDataToSales} disabled={!chaDataRows.length || chaDataLoading}>
                      Merge to Sales
                    </Button>
                  </Space>
                }
              />
            </div>
        </AppShell>
  )
}
