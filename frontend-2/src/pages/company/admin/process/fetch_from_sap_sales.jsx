import { ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import { Button, Input, Layout, Space, Table, Typography, Upload, message } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography
const { TextArea } = Input

const SALES_DATA_DEFAULT_LIMIT = 50
const SALES_DATA_MAX_LIMIT = 500

function clampSalesDataPage(page) {
  const n = Number(page)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.floor(n)
}

function clampSalesDataLimit(limit) {
  const n = Number(limit)
  if (!Number.isFinite(n) || n < 1) return SALES_DATA_DEFAULT_LIMIT
  return Math.min(SALES_DATA_MAX_LIMIT, Math.max(1, Math.floor(n)))
}

function normalizeSalesDataRows(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.data)) return payload.data
    if (Array.isArray(payload.rows)) return payload.rows
    if (Array.isArray(payload.items)) return payload.items
  }
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

export default function CompanyAdminFetchFromSapSalesPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [reportDateLow, setReportDateLow] = useState('01.01.2024')
  const [reportDateHigh, setReportDateHigh] = useState('05.01.2024')
  const [targetUsername, setTargetUsername] = useState('FI_SNT2')
  const [targetPassword, setTargetPassword] = useState('Sharp@12345')
  const [companyId, setCompanyId] = useState('')
  const [sapJsonText, setSapJsonText] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [salesDataRows, setSalesDataRows] = useState([])
  const [salesDataLoading, setSalesDataLoading] = useState(false)
  const [salesDataPage, setSalesDataPage] = useState(1)
  const [salesDataLimit, setSalesDataLimit] = useState(SALES_DATA_DEFAULT_LIMIT)
  const [salesDataTotal, setSalesDataTotal] = useState(0)

  const fetchSalesData = useCallback(
    async (page, limit) => {
      if (!BACKEND_URL) return
      const p = clampSalesDataPage(page)
      const l = clampSalesDataLimit(limit)
      setSalesDataLoading(true)
      try {
        const params = new URLSearchParams({
          page: String(p),
          limit: String(l),
        })
        const res = await fetch(`${BACKEND_URL}/api/company/admin/process/get-sales-data?${params}`, {
          method: 'GET',
          credentials: 'include',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.detail || data?.message || `Failed to load sales data (${res.status})`)
        }
        const rows = normalizeSalesDataRows(data).filter((r) => r && typeof r === 'object')
        setSalesDataRows(rows)

        let total = 0
        if (data.pagination && typeof data.pagination === 'object') {
          const pg = data.pagination
          setSalesDataPage(clampSalesDataPage(pg.page ?? p))
          setSalesDataLimit(clampSalesDataLimit(pg.limit ?? l))
          total = Number(pg.total)
        } else {
          setSalesDataPage(p)
          setSalesDataLimit(l)
          total = Number(data.total ?? data.totalCount)
        }

        if (!Number.isFinite(total)) total = rows.length
        setSalesDataTotal(total)
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Failed to load sales data')
        setSalesDataRows([])
        setSalesDataTotal(0)
      } finally {
        setSalesDataLoading(false)
      }
    },
    [BACKEND_URL],
  )

  useEffect(() => {
    if (!BACKEND_URL) return
    fetchSalesData(1, SALES_DATA_DEFAULT_LIMIT)
  }, [BACKEND_URL, fetchSalesData])

  const salesDataColumns = useMemo(() => getTableColumnsFromRows(salesDataRows), [salesDataRows])

  const postSapPayload = useCallback(
    async (body) => {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/process/data-from-sap`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `SAP ingest failed (${res.status})`)
      }
      return data
    },
    [BACKEND_URL],
  )

  const handleImportSapJson = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }

    const trimmedCompanyId = String(companyId || '').trim()
    const raw = String(sapJsonText || '').trim()
    if (!raw) {
      message.error('Paste SAP JSON response first.')
      return
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      message.error('Invalid JSON.')
      return
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      message.error('SAP JSON must be an object with a `data` array.')
      return
    }
    if (!Array.isArray(parsed.data)) {
      message.error('SAP JSON must include a `data` array.')
      return
    }

    const body = {
      ...parsed,
      companyid: String(parsed.companyid ?? parsed.companyId ?? trimmedCompanyId).trim(),
    }
    if (!body.companyid) {
      message.error('Provide company ID in the form or inside the JSON as `companyid`.')
      return
    }

    setSubmitting(true)
    try {
      const data = await postSapPayload(body)
      const stored = data?.data?.stored_rows
      message.success(
        data?.message ||
          (stored != null
            ? `Imported ${stored} row(s) from SAP JSON.`
            : 'SAP JSON imported successfully.'),
      )
      fetchSalesData(1, salesDataLimit)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'SAP JSON import failed')
    } finally {
      setSubmitting(false)
    }
  }, [BACKEND_URL, companyId, fetchSalesData, postSapPayload, salesDataLimit, sapJsonText])

  const handleSapJsonFile = useCallback((file) => {
    const reader = new FileReader()
    reader.onload = () => {
      setSapJsonText(String(reader.result || ''))
      message.success(`Loaded ${file.name}`)
    }
    reader.onerror = () => message.error('Could not read file.')
    reader.readAsText(file)
    return false
  }, [])

  const handleFetchFromSap = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }

    const body = {
      REPORT_DATE_LOW: String(reportDateLow || '').trim(),
      REPORT_DATE_HIGH: String(reportDateHigh || '').trim(),
      TARGET_USERNAME: String(targetUsername || '').trim(),
      TARGET_PASSWORD: String(targetPassword || ''),
    }
    const trimmedCompanyId = String(companyId || '').trim()
    if (trimmedCompanyId) body.companyid = trimmedCompanyId

    if (!body.REPORT_DATE_LOW || !body.REPORT_DATE_HIGH || !body.TARGET_USERNAME || !body.TARGET_PASSWORD) {
      message.error('All 4 SAP fetch fields are required.')
      return
    }

    setSubmitting(true)
    try {
      const data = await postSapPayload(body)
      message.success(data?.message || 'Fetch from SAP completed')
      fetchSalesData(1, salesDataLimit)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Fetch from SAP failed')
    } finally {
      setSubmitting(false)
    }
  }, [
    BACKEND_URL,
    companyId,
    fetchSalesData,
    postSapPayload,
    reportDateHigh,
    reportDateLow,
    salesDataLimit,
    targetPassword,
    targetUsername,
  ])

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="middle" style={{ width: '100%', minWidth: 0 }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                Fetch sales from SAP
              </Title>
              <Text type="secondary">Fetch from SAP service or import a SAP JSON response, then view stored sales data below.</Text>
            </div>

            <div>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                Company ID
              </Text>
              <Input
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                placeholder="companyid (optional if included in JSON)"
                disabled={submitting}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12,
              }}
            >
              <Input
                value={reportDateLow}
                onChange={(e) => setReportDateLow(e.target.value)}
                placeholder="REPORT_DATE_LOW (DD.MM.YYYY)"
                disabled={submitting}
              />
              <Input
                value={reportDateHigh}
                onChange={(e) => setReportDateHigh(e.target.value)}
                placeholder="REPORT_DATE_HIGH (DD.MM.YYYY)"
                disabled={submitting}
              />
              <Input
                value={targetUsername}
                onChange={(e) => setTargetUsername(e.target.value)}
                placeholder="TARGET_USERNAME"
                disabled={submitting}
              />
              <Input.Password
                value={targetPassword}
                onChange={(e) => setTargetPassword(e.target.value)}
                placeholder="TARGET_PASSWORD"
                disabled={submitting}
              />
            </div>

            <div>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                SAP JSON response
              </Text>
              <TextArea
                value={sapJsonText}
                onChange={(e) => setSapJsonText(e.target.value)}
                placeholder='{"companyid":"...","connection":"GRP DEV","completed_at":"...","data":[...]}'
                rows={8}
                disabled={submitting}
              />
            </div>

            <Space wrap>
              <Button
                type="primary"
                loading={submitting}
                onClick={handleFetchFromSap}
                disabled={!BACKEND_URL || submitting}
              >
                Fetch from SAP
              </Button>
              <Button
                type="primary"
                loading={submitting}
                onClick={handleImportSapJson}
                disabled={!BACKEND_URL || submitting}
              >
                Import SAP JSON
              </Button>
              <Upload accept=".json,application/json" showUploadList={false} beforeUpload={handleSapJsonFile}>
                <Button icon={<UploadOutlined />} disabled={submitting}>
                  Load JSON file
                </Button>
              </Upload>
              <Button
                type="default"
                icon={<ReloadOutlined />}
                loading={salesDataLoading}
                onClick={() => fetchSalesData(salesDataPage, salesDataLimit)}
                disabled={!BACKEND_URL || salesDataLoading}
              >
                Refresh data
              </Button>
            </Space>

            <div style={{ minWidth: 0, width: '100%', maxWidth: '100%', overflowX: 'auto' }}>
              <Table
                rowKey={(_, index) => `sap-sales-${salesDataPage}-${index}`}
                columns={salesDataColumns}
                dataSource={salesDataRows}
                loading={salesDataLoading}
                pagination={{
                  current: salesDataPage,
                  pageSize: salesDataLimit,
                  total: salesDataTotal,
                  showSizeChanger: true,
                  pageSizeOptions: ['10', '20', '50', '100', '200', '500'],
                  showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}`,
                  onChange: (page, pageSize) => fetchSalesData(page, pageSize),
                  onShowSizeChange: (_, size) => fetchSalesData(1, size),
                }}
                scroll={{ x: 'max-content', y: 520 }}
                size="small"
              />
            </div>
          </Space>
        </AppShell>
  )
}
