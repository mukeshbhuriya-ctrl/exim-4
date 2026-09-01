import { DownloadOutlined } from '@ant-design/icons'
import { Button, ConfigProvider, Input, Layout, Select, Space, Table, Typography, message, Tabs, Card, Tag } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'
import ProDataTable from '../../../../components/shared/ProDataTable.jsx'

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
  const [filterGstin, setFilterGstin] = useState('')
  const [chaDataLoading, setChaDataLoading] = useState(false)
  const [mergingToSales, setMergingToSales] = useState(false)
  const [chaDataMeta, setChaDataMeta] = useState(null)
  const [chaDataRows, setChaDataRows] = useState([])
  const [tableRefreshKey, setTableRefreshKey] = useState(0)

  useEffect(() => {
    setTableRefreshKey((prev) => prev + 1)
  }, [chaDataRows])

  const chaDataColumns = useMemo(() => buildColumnsFromRows(chaDataRows), [chaDataRows])

  const fetchMainTableData = useCallback(async ({ page, limit, search }) => {
    let filtered = chaDataRows
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
  }, [chaDataRows])

  const fetchChaData = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    setChaDataLoading(true)
    setChaDataMeta(null)
    setChaDataRows([])
    try {
      const params = new URLSearchParams()
      const month = composeSbMonthAndYear(filterMonthAbbr, filterYear)
      const gstin = filterGstin.trim()
      if (month) params.set('month', month)
      if (gstin) params.set('gstin', gstin)
      const qs = params.toString()
      const url = `${BACKEND_URL}/api/company/admin/cha/get-cha-data${qs ? `?${qs}` : ''}`
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load CHA data (${res.status})`)
      }
      if (data?.success === false) {
        throw new Error(data?.message || 'Failed to load CHA data')
      }
      const rows = normalizeChaRows(data)
      setChaDataRows(rows)
      const metaMonth = data?.sbMonthAndYear ?? null
      if (metaMonth) {
        const parsed = parseSbMonthAndYear(metaMonth)
        if (parsed.monthAbbr) setFilterMonthAbbr(parsed.monthAbbr)
        if (parsed.year != null) setFilterYear(parsed.year)
      }
      setChaDataMeta({
        sbMonthAndYear: metaMonth,
        gstin: data?.gstin ?? null,
        count: data?.count ?? rows.length,
      })
      if (!rows.length) {
        message.info('No CHA rows returned for this filter.')
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load CHA data')
      setChaDataRows([])
      setChaDataMeta(null)
    } finally {
      setChaDataLoading(false)
    }
  }, [BACKEND_URL, filterMonthAbbr, filterYear, filterGstin])

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

  const tabItems = [
    {
      key: 'data',
      label: 'Data Retrieval',
      children: (
        <Space direction="vertical" size={24} style={{ width: '100%', minWidth: 0 }}>
          <Card bordered={false} style={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)' }} bodyStyle={{ padding: 24 }}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <div>
                <Title level={5} style={{ margin: 0, color: '#1e293b' }}>Filter & Load CHA Data</Title>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  GET <Text code>/api/company/admin/cha/get-cha-data</Text> — optional month/year (last {YEARS_BACK} years) and <Text code>gstin</Text>.
                </Text>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <Space direction="vertical" size={4}>
                  <Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>Month / Year</Text>
                  <Space size={8}>
                    <Select
                      placeholder="Month"
                      value={filterMonthAbbr}
                      onChange={setFilterMonthAbbr}
                      options={MONTH_SELECT_OPTIONS}
                      allowClear
                      style={{ width: 100 }}
                    />
                    <Select
                      placeholder="Year"
                      value={filterYear}
                      onChange={setFilterYear}
                      options={yearOptions}
                      allowClear
                      style={{ width: 100 }}
                    />
                  </Space>
                </Space>
                <Space direction="vertical" size={4}>
                  <Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>GSTIN</Text>
                  <Input
                    placeholder="e.g. 24AAFCI0903C1ZB"
                    value={filterGstin}
                    onChange={(e) => setFilterGstin(e.target.value)}
                    onPressEnter={fetchChaData}
                    allowClear
                    style={{ width: 240 }}
                  />
                </Space>
                <Space style={{ marginBottom: 1 }}>
                  <Button type="primary" loading={chaDataLoading} onClick={fetchChaData} disabled={!BACKEND_URL} style={{ borderRadius: 6 }}>
                    Load CHA data
                  </Button>
                  <Button
                    icon={<DownloadOutlined />}
                    onClick={handleExportChaExcel}
                    disabled={!chaDataRows.length || chaDataLoading || mergingToSales}
                    style={{ borderRadius: 6 }}
                  >
                    Export to Excel
                  </Button>
                  <Button
                    loading={mergingToSales}
                    onClick={handleMergeChaDataToSales}
                    disabled={!BACKEND_URL || chaDataLoading || mergingToSales}
                    style={{ borderRadius: 6 }}
                  >
                    Merge to Sales
                  </Button>
                  <Button
                    onClick={() => {
                      setFilterMonthAbbr(undefined)
                      setFilterYear(undefined)
                      setFilterGstin('')
                      setChaDataRows([])
                      setChaDataMeta(null)
                    }}
                    disabled={chaDataLoading || mergingToSales}
                    style={{ borderRadius: 6 }}
                  >
                    Clear
                  </Button>
                </Space>
              </div>
              {chaDataMeta ? (
                <div style={{ padding: '12px 16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  <Space size="small">
                    <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>Month:</Text>
                    <Tag color="blue" style={{ margin: 0 }}>{chaDataMeta.sbMonthAndYear ?? '—'}</Tag>
                  </Space>
                  <Space size="small">
                    <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>GSTIN:</Text>
                    <Text strong>{chaDataMeta.gstin || '—'}</Text>
                  </Space>
                  <Space size="small">
                    <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>Count:</Text>
                    <Text strong>{chaDataMeta.count ?? chaDataRows.length}</Text>
                  </Space>
                </div>
              ) : null}
            </Space>
          </Card>

          {chaDataRows.length > 0 || chaDataLoading ? (
            <div style={{ animation: 'fadeIn 0.3s' }}>
              <ProDataTable
                columns={chaDataColumns}
                fetchData={fetchMainTableData}
                refreshKey={tableRefreshKey}
                rowKey={(r, i) => String(r?._id ?? `cha-row-${i}-${r?.sbNo ?? ''}`)}
                globalSearchPlaceholder="Search loaded CHA data..."
                showSelectionColumn={false}
              />
            </div>
          ) : (
            <div style={{ padding: '60px 20px', textAlign: 'center', background: '#f8fafc', borderRadius: 12, border: '2px solid #e2e8f0', animation: 'fadeIn 0.3s' }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ width: 48, height: 48, background: '#e0e7ff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                  <DownloadOutlined style={{ fontSize: 20, color: '#4f46e5' }} />
                </div>
              </div>
              <Title level={5} style={{ color: '#1e293b', marginBottom: 8 }}>No CHA Data Loaded</Title>
              <Text type="secondary">Use the filters above and click "Load CHA data" to view records.</Text>
            </div>
          )}
        </Space>
      ),
    },
    {
      key: 'process',
      label: 'Process Execution',
      children: (
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          <Card bordered={false} style={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)' }} bodyStyle={{ padding: 24 }}>
            <Space direction="vertical" size={24} style={{ width: '100%' }}>
              
              {/* Standard Process */}
              <div>
                <Title level={5} style={{ margin: 0, color: '#1e293b', marginBottom: 8 }}>Standard Monthly Process</Title>
                <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
                  Run the current-month CHA workflow with full OTP verification.
                </Text>
                <Button
                  type="primary"
                  loading={loadingWithOtp}
                  onClick={handleStartCurrentMonthProcess}
                  disabled={!BACKEND_URL || loadingWithoutOtp}
                  style={{ borderRadius: 6, boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)' }}
                >
                  Start current month process
                </Button>
              </div>

              <div style={{ height: 1, background: '#e2e8f0', width: '100%' }} />

              {/* Without OTP Process */}
              <div>
                <Title level={5} style={{ margin: 0, color: '#1e293b', marginBottom: 8 }}>Unattended Process (Without OTP)</Title>
                <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
                  Run the workflow without OTP. Optionally provide <Text code>sbMonthAndYear</Text>, <Text code>month</Text>, and <Text code>sectionIndex</Text>.
                </Text>
                
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <Space direction="vertical" size={4}>
                    <Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>Target Month / Year</Text>
                    <Space size={8}>
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
                    </Space>
                  </Space>
                  <Space direction="vertical" size={4}>
                    <Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>Section Index</Text>
                    <Input
                      placeholder="e.g. 0"
                      value={processWithoutOtpSectionIndex}
                      onChange={(e) => setProcessWithoutOtpSectionIndex(e.target.value)}
                      allowClear
                      style={{ width: 160 }}
                      disabled={loadingWithoutOtp}
                    />
                  </Space>
                  <Button
                    loading={loadingWithoutOtp}
                    onClick={handleStartCurrentMonthProcessWithoutOtp}
                    disabled={!BACKEND_URL || loadingWithOtp}
                    style={{ borderRadius: 6, marginBottom: 1 }}
                  >
                    Start process (without OTP)
                  </Button>
                </div>
              </div>

            </Space>
          </Card>
        </Space>
      ),
    },
  ]

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <Space direction="vertical" size={16} style={{ width: '100%', minWidth: 0 }}>
        <PageHeader
          title="Monthly CHA Operations"
          description="Manage current-month CHA workflows, retrieve data, and export to Excel."
        />
        <ConfigProvider
          theme={{
            token: { colorPrimary: '#2563eb', borderRadius: 6, colorText: '#1e293b' },
            components: {
              Table: { headerBg: '#f1f5f9', headerColor: '#334155', headerBorderRadius: 8, borderColor: '#e2e8f0', rowHoverBg: '#f8fafc', cellPaddingBlock: 12 },
              Button: { primaryColor: '#ffffff', colorPrimary: '#2563eb', colorPrimaryHover: '#1d4ed8', colorPrimaryActive: '#1e40af' },
              Tabs: { itemColor: '#64748b', itemSelectedColor: '#2563eb', itemHoverColor: '#3b82f6', titleFontSize: 15 },
            }
          }}
        >
          <Tabs defaultActiveKey="data" items={tabItems} style={{ marginTop: -8 }} />
        </ConfigProvider>
      </Space>
    </AppShell>
  )
}
