import { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { Button, DatePicker, Select, message } from 'antd'
import { Eye, Search, RefreshCcw, FileText, AlertCircle, Building2, Calendar, FileSpreadsheet } from 'lucide-react'
import SiteAdminSidebar from '../../components/siteadmin/sidebar.jsx'
import AppShell from '../../components/layout/AppShell.jsx'
import PageHeader from '../../components/common/PageHeader.jsx'
import ProDataTable from '../../components/shared/ProDataTable.jsx'

function normalizeCompanies(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.companies)) return payload.companies
    if (Array.isArray(payload.data)) return payload.data
    if (payload.data && typeof payload.data === 'object' && Array.isArray(payload.data.companies)) {
      return payload.data.companies
    }
  }
  return []
}

function normalizeReports(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.rows)) return payload.rows
    if (Array.isArray(payload.data)) return payload.data
    if (payload.data && typeof payload.data === 'object' && Array.isArray(payload.data.rows)) {
      return payload.data.rows
    }
  }
  return []
}

function normalizeDetailRows(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    if (payload.row && typeof payload.row === 'object' && Array.isArray(payload.row.billedRows)) {
      return payload.row.billedRows
    }
    if (Array.isArray(payload.rows)) return payload.rows
    if (payload.data && typeof payload.data === 'object') {
      if (payload.data.row && typeof payload.data.row === 'object' && Array.isArray(payload.data.row.billedRows)) {
        return payload.data.row.billedRows
      }
      if (Array.isArray(payload.data.rows)) return payload.data.rows
      if (Array.isArray(payload.data.billedRows)) return payload.data.billedRows
    }
    if (Array.isArray(payload.billedRows)) return payload.billedRows
  }
  return []
}

export default function SiteAdminViewBillesPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [currentView, setCurrentView] = useState('list')
  const [companies, setCompanies] = useState([])
  const [companyId, setCompanyId] = useState(undefined)
  const [dateRange, setDateRange] = useState(() => [dayjs().startOf('month'), dayjs().endOf('month')])
  const [rows, setRows] = useState([])
  const [loadingCompanies, setLoadingCompanies] = useState(false)
  const [loadingReports, setLoadingReports] = useState(false)
  const [error, setError] = useState('')

  const [detailLoading, setDetailLoading] = useState(false)
  const [detailHeader, setDetailHeader] = useState(null)
  const [detailRows, setDetailRows] = useState([])

  const fetchCompanies = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoadingCompanies(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/siteadmin/company/`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || data?.detail || `Failed to load companies (${res.status})`)
      }
      const list = normalizeCompanies(data).filter((r) => r && typeof r === 'object')
      setCompanies(list)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load companies')
    } finally {
      setLoadingCompanies(false)
    }
  }, [BACKEND_URL])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  const handleSearch = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured.')
      return
    }
    const [start, end] = dateRange || []
    setLoadingReports(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (companyId) params.set('companyId', String(companyId))
      if (start && dayjs.isDayjs(start)) params.set('startDate', start.format('YYYY-MM-DD'))
      if (end && dayjs.isDayjs(end)) params.set('endDate', end.format('YYYY-MM-DD'))

      const res = await fetch(`${BACKEND_URL}/api/siteadmin/billing/billing-report?${params}`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || data?.detail || `Failed to load billing reports (${res.status})`)
      const list = normalizeReports(data).filter((r) => r && typeof r === 'object')
      setRows(list)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load billing reports'
      setError(msg)
      setRows([])
      message.error(msg)
    } finally {
      setLoadingReports(false)
    }
  }, [BACKEND_URL, companyId, dateRange])

  const openDetail = useCallback(
    async (id) => {
      if (!BACKEND_URL || !id) return
      setDetailLoading(true)
      setDetailHeader(null)
      setDetailRows([])
      setCurrentView('view')
      try {
        const res = await fetch(`${BACKEND_URL}/api/siteadmin/billing/detailed-billing-report/${id}`, {
          method: 'GET',
          credentials: 'include',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.message || data?.detail || `Failed to load detailed report (${res.status})`)
        }
        const header =
          data?.row ||
          data?.data?.row ||
          data?.header ||
          data?.report ||
          data?.data?.header ||
          data?.data?.report ||
          data?.data ||
          data
        setDetailHeader(header && typeof header === 'object' ? header : null)
        setDetailRows(normalizeDetailRows(data).filter((r) => r && typeof r === 'object'))
      } catch (e) {
        message.error(e instanceof Error ? e.message : 'Failed to load detailed billing report')
        setCurrentView('list')
      } finally {
        setDetailLoading(false)
      }
    },
    [BACKEND_URL],
  )

  const companyOptions = useMemo(
    () =>
      companies.map((c) => ({
        value: String(c.id || c._id),
        label: c.name || c.companyName || String(c.id || c._id),
      })),
    [companies],
  )

  const reportFetchData = useCallback(async ({ page = 1, limit = 15 }) => {
    const start = (page - 1) * limit
    return { data: rows.slice(start, start + limit), meta: { total: rows.length } }
  }, [rows])

  const detailFetchData = useCallback(async ({ page = 1, limit = 15 }) => {
    const start = (page - 1) * limit
    return { data: detailRows.slice(start, start + limit), meta: { total: detailRows.length } }
  }, [detailRows])

  const reportColumns = [
    { title: 'Company Name', dataIndex: 'companyName', key: 'companyName' },
    { title: 'Fee Note No', dataIndex: 'feeNoteNo', key: 'feeNoteNo' },
    { title: 'Day Key', dataIndex: 'dayKey', key: 'dayKey' },
    { title: 'Per Row Amount', dataIndex: 'perRowAmount', key: 'perRowAmount' },
    { title: 'Total Amount', dataIndex: 'totalAmount', key: 'totalAmount' },
    { title: 'Rows Count', dataIndex: 'rowsCount', key: 'rowsCount' },
    { title: 'Created At', dataIndex: 'createdAt', key: 'createdAt' },
    {
      title: 'Action',
      key: 'action',
      width: 90,
      render: (_, row) => (
        <Button 
          type="text" 
          icon={<Eye size={16} />} 
          onClick={() => openDetail(row?.id || row?._id)}
          className="text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md flex items-center justify-center w-8 h-8"
        />
      ),
    },
  ]

  const detailColumns = [
    { title: 'SB Number', dataIndex: 'sbnumber', key: 'sbnumber' },
    { title: 'SB Date', dataIndex: 'sbdate', key: 'sbdate' },
    { title: 'SB Port', dataIndex: 'sbport', key: 'sbport' },
    { title: 'Billing Status', dataIndex: 'billingstatus', key: 'billingstatus' },
  ]

  return (
    <AppShell sidebar={<SiteAdminSidebar />} portalType="siteadmin">
      <PageHeader
        title={currentView === 'view' ? 'Billing Report Details' : 'View Bills'}
        description={
          currentView === 'view' 
          ? 'Detailed breakdown of the billed shipping bills for this report.' 
          : 'Search and view billing reports and detailed billed rows.'
        }
        actions={
          currentView === 'view' && (
            <Button onClick={() => setCurrentView('list')} className="font-medium h-9 rounded-md">
              Back to List
            </Button>
          )
        }
      />

      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-1 pb-10 space-y-6">
        {!BACKEND_URL && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-md p-4 flex items-center gap-3">
            <AlertCircle size={20} />
            <span className="font-medium text-sm">VITE_BACKEND_URL is not configured.</span>
          </div>
        )}
        
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-md p-4 flex items-center gap-3">
            <AlertCircle size={20} />
            <span className="font-medium text-sm">{error}</span>
          </div>
        )}

        {currentView === 'list' ? (


          <>
            <div className="bg-white border border-slate-200 rounded-lg flex flex-col min-h-[400px]">
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="font-semibold text-slate-800">Billing Reports ({rows.length})</div>
                <FileText size={18} className="text-slate-400" />
              </div>
              <div className="flex-1 min-h-0">
                <ProDataTable
                  columns={reportColumns}
                  fetchData={reportFetchData}
                  refreshKey={rows.length}
                  rowKey={(r, i) => String(r?.id || r?._id || `billing-report-${i}`)}
                  pagination={{ pageSize: 15 }}
                  customToolbarActions={
                    <div className="flex items-center gap-2 ml-4">
                      <Select
                        style={{ width: 180, height: 36 }}
                        placeholder="All Companies"
                        value={companyId}
                        onChange={setCompanyId}
                        options={companyOptions}
                        loading={loadingCompanies}
                        allowClear
                        showSearch
                        optionFilterProp="label"
                      />
                      <DatePicker.RangePicker
                        style={{ width: 240, height: 36 }}
                        className="border-slate-200"
                        value={dateRange}
                        onChange={(v) => setDateRange(v)}
                        format="YYYY-MM-DD"
                      />
                      <Button
                        type="primary"
                        className="bg-blue-600 hover:bg-blue-700 font-medium rounded-md border-none shadow-none flex items-center gap-1.5 h-9 px-4"
                        loading={loadingReports}
                        onClick={handleSearch}
                        icon={<Search size={16} />}
                      >
                        Search
                      </Button>
                      <button
                        type="button"
                        style={{ height: 36, width: 36 }}
                        className="rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
                        onClick={fetchCompanies} 
                        title="Refresh Companies"
                        disabled={loadingCompanies}
                      >
                        <RefreshCcw size={16} className={loadingCompanies ? 'animate-spin' : ''} />
                      </button>
                    </div>
                  }
                />
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-lg p-6">
              <div className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-5">
                Report Summary
              </div>
              {detailLoading ? (
                <div className="text-slate-500 py-4">Loading details...</div>
              ) : detailHeader ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-6 gap-x-8">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5"><Building2 size={12}/> Company</div>
                    <div className="font-medium text-slate-800">{String(detailHeader?.companyName ?? detailHeader?.companyId ?? '—')}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5"><FileText size={12}/> Fee Note No</div>
                    <div className="font-medium text-slate-800">{String(detailHeader?.feeNoteNo ?? '—')}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5"><Calendar size={12}/> Day Key</div>
                    <div className="font-medium text-slate-800">{String(detailHeader?.dayKey ?? '—')}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Per Row Amount</div>
                    <div className="font-medium text-slate-800">{String(detailHeader?.perRowAmount ?? '—')}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Total Amount</div>
                    <div className="font-medium text-slate-800">{String(detailHeader?.totalAmount ?? '—')}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Rows Count</div>
                    <div className="font-medium text-slate-800">{String(detailHeader?.rowsCount ?? detailRows.length)}</div>
                  </div>
                </div>
              ) : (
                <div className="text-slate-500 py-4">No header details available.</div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-lg flex flex-col min-h-[400px]">
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="font-semibold text-slate-800">Billed Shipping Bills ({detailRows.length})</div>
                <FileSpreadsheet size={18} className="text-slate-400" />
              </div>
              <div className="flex-1 min-h-0">
                <ProDataTable
                  columns={detailColumns}
                  fetchData={detailFetchData}
                  refreshKey={detailRows.length + (detailLoading ? 1 : 0)}
                  rowKey={(r, i) => `${r?.sbnumber || 'sb'}-${r?.sbdate || 'date'}-${r?.sbport || 'port'}-${i}`}
                  pagination={{ pageSize: 15 }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
