import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import SiteAdminSidebar from '../../components/siteadmin/sidebar.jsx'
import AppShell from '../../components/layout/AppShell.jsx'

const { Title, Text } = Typography
const { TextArea } = Input

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

export default function SiteAdminBillingPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [companies, setCompanies] = useState([])
  const [companyId, setCompanyId] = useState(undefined)
  const [dateRange, setDateRange] = useState(() => [dayjs().startOf('month'), dayjs().endOf('month')])
  const [billingName, setBillingName] = useState('')
  const [billingDescription, setBillingDescription] = useState('')
  const [loadingCompanies, setLoadingCompanies] = useState(false)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [createdBilling, setCreatedBilling] = useState(null)

  const fetchCompanies = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoadingCompanies(true)
    setError('')
    try {
      const res = await fetch(`${BACKEND_URL}/api/siteadmin/company/`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || data?.detail || `Failed to load companies (${res.status})`)
      }
      const list = normalizeCompanies(data).filter((c) => c && typeof c === 'object')
      setCompanies(list)
      setCompanyId((prev) => {
        if (prev) return prev
        const firstId = list[0]?.id || list[0]?._id
        return firstId ? String(firstId) : undefined
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load companies'
      setError(msg)
      message.error(msg)
    } finally {
      setLoadingCompanies(false)
    }
  }, [BACKEND_URL])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  const handleFetch = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    const [from, to] = dateRange || []
    if (!companyId) {
      message.error('Please select a company.')
      return
    }
    if (!from || !to || !dayjs.isDayjs(from) || !dayjs.isDayjs(to)) {
      message.error('Please select a valid start and end date.')
      return
    }

    setLoading(true)
    setError('')
    setCreatedBilling(null)
    try {
      const params = new URLSearchParams({
        companyId: String(companyId),
        startDate: from.format('YYYY-MM-DD'),
        endDate: to.format('YYYY-MM-DD'),
      })
      const res = await fetch(
        `${BACKEND_URL}/api/siteadmin/billing/fully-matched-sb-by-date?${params}`,
        { method: 'GET', credentials: 'include' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || data?.detail || `Request failed (${res.status})`)
      }
      setResult(data)
      message.success(
        `Found ${data?.sbNoCount ?? 0} unique SB No(s) from ${data?.fullyMatchedInvoiceCount ?? 0} fully matched invoice(s).`
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load fully matched SB data'
      setError(msg)
      setResult(null)
      message.error(msg)
    } finally {
      setLoading(false)
    }
  }, [BACKEND_URL, companyId, dateRange])

  const handleCreateBilling = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    const [from, to] = dateRange || []
    if (!companyId) {
      message.error('Please select a company.')
      return
    }
    if (!from || !to || !dayjs.isDayjs(from) || !dayjs.isDayjs(to)) {
      message.error('Please select a valid start and end date.')
      return
    }
    const name = String(billingName || '').trim()
    if (!name) {
      message.error('Billing name is required.')
      return
    }
    if (!result?.sbNoCount) {
      message.warning('Load matched invoices first (no SB Nos to bill).')
      return
    }

    setCreating(true)
    setError('')
    try {
      const res = await fetch(`${BACKEND_URL}/api/siteadmin/billing/create-billing`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: String(companyId),
          startDate: from.format('YYYY-MM-DD'),
          endDate: to.format('YYYY-MM-DD'),
          name,
          description: String(billingDescription || '').trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || data?.detail || `Create billing failed (${res.status})`)
      }
      setCreatedBilling(data.billing || data)
      if (data.billing?.fullyMatched || data.fullyMatched) {
        setResult((prev) => ({
          ...(prev || {}),
          ...(data.billing || data),
          fullyMatched: data.billing?.fullyMatched ?? data.fullyMatched ?? prev?.fullyMatched,
          sbNos: data.billing?.sbNos ?? data.sbNos ?? prev?.sbNos,
        }))
      }
      message.success(
        data?.message ||
          `Billing created. Updated ${data?.billing?.shippingBillUpdated ?? 0} shipping bill(s).`
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create billing'
      setError(msg)
      message.error(msg)
    } finally {
      setCreating(false)
    }
  }, [
    BACKEND_URL,
    companyId,
    dateRange,
    billingName,
    billingDescription,
    result?.sbNoCount,
  ])

  const companyOptions = useMemo(
    () =>
      companies.map((c) => ({
        value: String(c.id || c._id),
        label: c.name || c.companyName || String(c.id || c._id),
      })),
    [companies]
  )

  const matchedRows = useMemo(() => {
    const list = Array.isArray(result?.fullyMatched) ? result.fullyMatched : []
    return list.map((row, i) => {
      const invoice = String(row?.invoice ?? '')
      const sbNos = Array.isArray(row?.sbNos)
        ? row.sbNos.map((s) => String(s)).filter(Boolean)
        : row?.sbNo
          ? [String(row.sbNo)]
          : []
      return {
        key: `row-${i}-${invoice}`,
        invoice,
        sbNo: sbNos[0] || '',
        sbNos,
        sbNosLabel: sbNos.join(', ') || '—',
      }
    })
  }, [result])

  const columns = [
    { title: '#', key: 'index', width: 72, render: (_, __, i) => i + 1 },
    { title: 'Invoice', dataIndex: 'invoice', key: 'invoice', width: 200 },
    { title: 'SB No', dataIndex: 'sbNosLabel', key: 'sbNos', ellipsis: true },
  ]

  return (
    <AppShell sidebar={<SiteAdminSidebar />} portalType="siteadmin">
      <Space direction="vertical" size="large" style={{ width: '100%', minWidth: 0 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Billing — Fully matched SB
          </Title>
          <Text type="secondary">
            Preview fully matched invoices / SB Nos for a date range, then create a billing
            record and mark matching shipping bills as completed.
          </Text>
        </div>

        {!BACKEND_URL ? (
          <Alert type="error" showIcon message="VITE_BACKEND_URL is not configured." />
        ) : null}
        {error ? <Alert type="error" message={error} showIcon /> : null}

        <Card size="small" title="1. Select company & date range">
          <Space wrap style={{ width: '100%' }}>
            <Select
              style={{ minWidth: 260 }}
              placeholder="Select company"
              value={companyId}
              onChange={(v) => {
                setCompanyId(v)
                setResult(null)
                setCreatedBilling(null)
              }}
              options={companyOptions}
              loading={loadingCompanies}
              showSearch
              optionFilterProp="label"
            />
            <DatePicker.RangePicker
              value={dateRange}
              onChange={(v) => {
                setDateRange(v)
                setResult(null)
                setCreatedBilling(null)
              }}
              format="YYYY-MM-DD"
              allowClear={false}
            />
            <Button
              type="primary"
              icon={<SearchOutlined />}
              loading={loading}
              onClick={handleFetch}
              disabled={!companyId || loading}
            >
              Load matched invoices
            </Button>
            <Button icon={<ReloadOutlined />} onClick={fetchCompanies} loading={loadingCompanies}>
              Refresh companies
            </Button>
          </Space>
        </Card>

        {result ? (
          <>
            <Row gutter={[16, 16]}>
              <Col xs={12} sm={8} md={4}>
                <Card size="small">
                  <Statistic title="Sales rows in range" value={result.salesRowsInRange ?? 0} />
                </Card>
              </Col>
              <Col xs={12} sm={8} md={4}>
                <Card size="small">
                  <Statistic title="Unique invoices" value={result.uniqueInvoicesInRange ?? 0} />
                </Card>
              </Col>
              <Col xs={12} sm={8} md={4}>
                <Card size="small">
                  <Statistic
                    title="Fully matched invoices"
                    value={result.fullyMatchedInvoiceCount ?? 0}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={8} md={4}>
                <Card size="small">
                  <Statistic title="Unique SB Nos" value={result.sbNoCount ?? 0} />
                </Card>
              </Col>
              <Col xs={24} sm={16} md={8}>
                <Card size="small">
                  <Space direction="vertical" size={4}>
                    <Text type="secondary">Filter column</Text>
                    <Tag color="blue">{result.filterDateColumn || '—'}</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {result.startDate || '—'} → {result.endDate || '—'}
                    </Text>
                  </Space>
                </Card>
              </Col>
            </Row>

            <Card size="small" title="2. Billing details">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Input
                  placeholder="Billing name"
                  value={billingName}
                  onChange={(e) => setBillingName(e.target.value)}
                  maxLength={120}
                />
                <TextArea
                  placeholder="Billing description"
                  value={billingDescription}
                  onChange={(e) => setBillingDescription(e.target.value)}
                  rows={3}
                  maxLength={1000}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    type="primary"
                    loading={creating}
                    disabled={!result?.sbNoCount || creating}
                    onClick={handleCreateBilling}
                  >
                    Create billing
                  </Button>
                </div>
              </Space>
            </Card>

            {createdBilling ? (
              <Alert
                type="success"
                showIcon
                message={`Billing created: ${createdBilling.name || createdBilling.id || '—'}`}
                description={
                  <Space wrap>
                    <Text>id: {String(createdBilling.id || createdBilling._id || '—')}</Text>
                    <Text>
                      shipping bills matched: {String(createdBilling.shippingBillMatched ?? 0)}
                    </Text>
                    <Text>
                      updated: {String(createdBilling.shippingBillUpdated ?? 0)}
                    </Text>
                    <Text>
                      not found: {String(createdBilling.shippingBillNotFound ?? 0)}
                    </Text>
                  </Space>
                }
              />
            ) : null}

            <Card
              size="small"
              title={`Invoice ↔ SB No (${matchedRows.length})`}
              styles={{ body: { padding: 0 } }}
            >
              <Table
                size="small"
                rowKey="key"
                columns={columns}
                dataSource={matchedRows}
                loading={loading || creating}
                pagination={{ pageSize: 25, size: 'small', showSizeChanger: true }}
                locale={{ emptyText: 'No fully matched invoices' }}
                scroll={{ x: 'max-content' }}
              />
            </Card>
          </>
        ) : (
          <Alert
            type="info"
            showIcon
            message="Select a company and date range, then click Load matched invoices."
          />
        )}
      </Space>
    </AppShell>
  )
}
