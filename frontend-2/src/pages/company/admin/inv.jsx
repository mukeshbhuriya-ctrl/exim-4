import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Input,
  Radio,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../components/company/sidebar.jsx'
import AppShell from '../../../components/layout/AppShell.jsx'

const { Title, Text } = Typography

const INV_BASE = '/api/company/admin/inv'

const SEARCH_MODES = {
  invoice: {
    value: 'invoice',
    label: 'Invoice',
    endpoint: '/matched-by-invoice',
    placeholder: 'Search by invoice number',
  },
  sbNo: {
    value: 'sbNo',
    label: 'SB No',
    endpoint: '/matched-by-sb',
    placeholder: 'Search by shipping bill number',
  },
}

function pickDisplay(data, keys) {
  if (!data || typeof data !== 'object') return {}
  const out = {}
  for (const key of keys) {
    if (data[key] != null && String(data[key]).trim() !== '') {
      out[key] = data[key]
    }
  }
  return out
}

export default function CompanyAdminInvPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [searchMode, setSearchMode] = useState('invoice')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [expandedRowKeys, setExpandedRowKeys] = useState([])
  const [hasLoaded, setHasLoaded] = useState(false)

  const modeConfig = SEARCH_MODES[searchMode] || SEARCH_MODES.invoice

  const loadRows = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoading(true)
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      })
      if (appliedSearch) qs.set('search', appliedSearch)

      const res = await fetch(`${BACKEND_URL}${INV_BASE}${modeConfig.endpoint}?${qs}`, {
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Failed to load (${res.status})`)
      }

      const list = Array.isArray(data.rows) ? data.rows : []
      setRows(list)
      setTotal(typeof data.total === 'number' ? data.total : 0)
      setExpandedRowKeys([])
      setHasLoaded(true)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load matched invoices')
      setRows([])
      setTotal(0)
      setHasLoaded(true)
    } finally {
      setLoading(false)
    }
  }, [BACKEND_URL, page, pageSize, appliedSearch, modeConfig.endpoint])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  const applySearch = () => {
    setPage(1)
    setAppliedSearch(searchInput.trim())
  }

  const clearSearch = () => {
    setSearchInput('')
    setAppliedSearch('')
    setPage(1)
  }

  const handleModeChange = (e) => {
    const next = e.target.value
    setSearchMode(next)
    setSearchInput('')
    setAppliedSearch('')
    setPage(1)
    setRows([])
    setTotal(0)
    setExpandedRowKeys([])
    setHasLoaded(false)
  }

  const columns = useMemo(() => {
    const sharedTail = [
      {
        title: 'Match',
        dataIndex: 'matchType',
        key: 'matchType',
        width: 90,
        render: (v) => (
          <Tag color={v === 'manual' ? 'purple' : 'blue'}>{v || 'auto'}</Tag>
        ),
      },
      {
        title: 'SB Online',
        key: 'sbOnlineStatus',
        width: 140,
        render: (_, row) => {
          const list = Array.isArray(row.sbOnline) ? row.sbOnline : []
          if (!list.length) return <Tag>Not fetched</Tag>
          const hasSuccess = list.some((r) => r.status === 'success')
          const hasError = list.some((r) => r.status === 'error')
          return (
            <Space size={4} wrap>
              <Tag color={hasSuccess ? 'success' : hasError ? 'error' : 'default'}>
                {hasSuccess ? 'Fetched' : hasError ? 'Error' : list[0]?.status || '—'}
              </Tag>
              <Tag>{list.length}</Tag>
            </Space>
          )
        },
      },
      {
        title: 'DGFT',
        key: 'dgftStatus',
        width: 140,
        render: (_, row) => {
          const list = Array.isArray(row.dgft) ? row.dgft : []
          const registryDgft = String(row.shippingBill?.dgft ?? '').toLowerCase() === 'true'
          if (!list.length && !registryDgft) return <Tag>Not fetched</Tag>
          const hasSuccess = list.some((r) => r.status === 'success')
          return (
            <Space size={4} wrap>
              <Tag color={hasSuccess || registryDgft ? 'success' : 'default'}>
                {hasSuccess ? 'Fetched' : registryDgft ? 'Marked' : list[0]?.status || '—'}
              </Tag>
              {list.length ? <Tag>{list.length}</Tag> : null}
            </Space>
          )
        },
      },
      {
        title: 'Billing',
        key: 'billing',
        width: 110,
        render: (_, row) => {
          const billing = row.shippingBill?.billing || 'pending'
          const color =
            String(billing).toLowerCase() === 'completed' ||
            String(billing).toLowerCase() === 'generated' ||
            String(billing).toLowerCase() === 'true' ||
            String(billing).toLowerCase() === 'done'
              ? 'success'
              : 'default'
          return <Tag color={color}>{billing}</Tag>
        },
      },
      {
        title: 'Matched At',
        dataIndex: 'matchedAt',
        key: 'matchedAt',
        width: 170,
        render: (v) => (v ? new Date(v).toLocaleString() : '—'),
      },
    ]

    // Matched-by-invoice: invoice + counts/status only (no SB No / SB Date / Port)
    if (searchMode === 'invoice') {
      return [
        {
          title: 'Invoice',
          dataIndex: 'invoice',
          key: 'invoice',
          width: 160,
          fixed: 'left',
          render: (v) => <Text strong>{v || '—'}</Text>,
        },
        {
          title: 'SB count',
          key: 'sbNoCount',
          width: 90,
          render: (_, row) => row.sbNoCount ?? row.sbNos?.length ?? 1,
        },
        ...sharedTail,
      ]
    }

    // Matched-by-sb: SB fields only (no Invoice column in table rows)
    return [
      {
        title: 'SB No',
        dataIndex: 'sbNo',
        key: 'sbNo',
        width: 130,
        fixed: 'left',
        render: (v) => <Text strong>{v || '—'}</Text>,
      },
      {
        title: 'SB Date',
        dataIndex: 'sbDate',
        key: 'sbDate',
        width: 120,
        render: (v) => v || '—',
      },
      {
        title: 'Port',
        dataIndex: 'portCode',
        key: 'portCode',
        width: 100,
        render: (v) => v || '—',
      },
      {
        title: 'Inv count',
        key: 'invoiceCount',
        width: 90,
        render: (_, row) => row.invoiceCount ?? row.invoices?.length ?? 1,
      },
      ...sharedTail,
    ]
  }, [searchMode])

  const expandedRowRender = (row) => {
    const salesPreview = pickDisplay(row.salesData, [
      'inv',
      'qty1',
      'qty2',
      'qty',
      'amount',
      'financialYear',
    ])
    const pdfPreview = pickDisplay(row.pdfData, [
      'inv',
      'SB No',
      'SB Date',
      'Port Code',
      'qty',
      'amount',
    ])

    const sbOnlineColumns = [
      { title: 'Day', dataIndex: 'dayKey', key: 'dayKey', width: 110 },
      { title: 'SB No', dataIndex: 'sbNo', key: 'sbNo', width: 120 },
      { title: 'SB Date', dataIndex: 'sbDate', key: 'sbDate', width: 120 },
      { title: 'Port', dataIndex: 'sbLocation', key: 'sbLocation', width: 100 },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        width: 100,
        render: (v) => (
          <Tag color={v === 'success' ? 'success' : v === 'error' ? 'error' : 'default'}>
            {v || '—'}
          </Tag>
        ),
      },
      {
        title: 'Error',
        dataIndex: 'errorMessage',
        key: 'errorMessage',
        ellipsis: true,
        render: (v) => v || '—',
      },
    ]

    const dgftColumns = [
      { title: 'Source', dataIndex: 'source', key: 'source', width: 110 },
      { title: 'Day', dataIndex: 'dayKey', key: 'dayKey', width: 110 },
      {
        title: 'SB No',
        key: 'sbNumber',
        width: 120,
        render: (_, r) => r.input?.sbNumber || '—',
      },
      {
        title: 'SB Date',
        key: 'sbDate',
        width: 120,
        render: (_, r) => r.input?.sbDate || '—',
      },
      {
        title: 'Port',
        key: 'port',
        width: 100,
        render: (_, r) => r.input?.port || '—',
      },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        width: 100,
        render: (v) => (
          <Tag color={v === 'success' ? 'success' : v === 'error' ? 'error' : 'default'}>
            {v || '—'}
          </Tag>
        ),
      },
      {
        title: 'Error',
        dataIndex: 'errorMessage',
        key: 'errorMessage',
        ellipsis: true,
        render: (v) => v || '—',
      },
    ]

    const invoices = Array.isArray(row.invoices) ? row.invoices : []
    const sbNos = Array.isArray(row.sbNos) ? row.sbNos : []

    return (
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {searchMode === 'sbNo' && invoices.length > 1 ? (
          <Card size="small" title={`Invoices on this SB (${invoices.length})`}>
            <Space wrap>
              {invoices.map((inv) => (
                <Tag key={inv.invoice} color="blue">
                  {inv.invoice}
                </Tag>
              ))}
            </Space>
          </Card>
        ) : null}

        {searchMode === 'invoice' && sbNos.length > 1 ? (
          <Card size="small" title={`SB Nos for this invoice (${sbNos.length})`}>
            <Space wrap>
              {sbNos.map((s) => (
                <Tag key={s.sbNo} color="purple">
                  {s.sbNo}
                </Tag>
              ))}
            </Space>
          </Card>
        ) : null}

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Card size="small" title="Sales row" style={{ flex: 1, minWidth: 260 }}>
            {Object.keys(salesPreview).length ? (
              <Space direction="vertical" size={2}>
                {Object.entries(salesPreview).map(([k, v]) => (
                  <Text key={k}>
                    <Text type="secondary">{k}: </Text>
                    {String(v)}
                  </Text>
                ))}
              </Space>
            ) : (
              <Text type="secondary">No preview fields</Text>
            )}
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                salesRowId: {row.salesRowId}
              </Text>
            </div>
          </Card>
          <Card size="small" title="PDF row" style={{ flex: 1, minWidth: 260 }}>
            {Object.keys(pdfPreview).length ? (
              <Space direction="vertical" size={2}>
                {Object.entries(pdfPreview).map(([k, v]) => (
                  <Text key={k}>
                    <Text type="secondary">{k}: </Text>
                    {String(v)}
                  </Text>
                ))}
              </Space>
            ) : (
              <Text type="secondary">No preview fields</Text>
            )}
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                pdfRowId: {row.pdfRowId}
              </Text>
            </div>
          </Card>
        </div>

        <Card size="small" title={`SB Online (${row.sbOnline?.length || 0})`}>
          <Table
            size="small"
            rowKey="id"
            columns={sbOnlineColumns}
            dataSource={row.sbOnline || []}
            pagination={false}
            locale={{ emptyText: 'No SB Online records for this SB No' }}
            scroll={{ x: 'max-content' }}
          />
        </Card>

        <Card size="small" title={`DGFT (${row.dgft?.length || 0})`}>
          <Table
            size="small"
            rowKey="id"
            columns={dgftColumns}
            dataSource={row.dgft || []}
            pagination={false}
            locale={{ emptyText: 'No DGFT records for this SB No' }}
            scroll={{ x: 'max-content' }}
          />
        </Card>
      </Space>
    )
  }

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Matched Invoices
          </Title>
          <Text type="secondary">
            Invoice mode returns unique invoices. SB No mode returns unique shipping bills.
          </Text>
        </div>

        {!BACKEND_URL ? (
          <Alert type="error" showIcon message="VITE_BACKEND_URL is not configured." />
        ) : null}

        <Card size="small" title="Search mode">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              value={searchMode}
              onChange={handleModeChange}
              options={[
                { label: 'Invoice', value: 'invoice' },
                { label: 'SB No', value: 'sbNo' },
              ]}
            />

            <Space wrap>
              <Input
                allowClear
                placeholder={modeConfig.placeholder}
                style={{ minWidth: 280 }}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onPressEnter={applySearch}
                prefix={<SearchOutlined />}
              />
              <Button type="primary" icon={<SearchOutlined />} onClick={applySearch} loading={loading}>
                Search
              </Button>
              <Button onClick={clearSearch} disabled={!appliedSearch && !searchInput}>
                Clear
              </Button>
              <Button icon={<ReloadOutlined />} onClick={loadRows} loading={loading}>
                Reload
              </Button>
              <Tag color={searchMode === 'invoice' ? 'blue' : 'purple'}>
                Mode: {modeConfig.label}
              </Tag>
              {appliedSearch ? (
                <Text type="secondary">
                  Filter: <Text code>{appliedSearch}</Text>
                </Text>
              ) : null}
              <Text type="secondary">
                {total} unique {searchMode === 'invoice' ? 'invoice(s)' : 'SB No(s)'}
              </Text>
            </Space>
          </Space>
        </Card>

        {hasLoaded ? (
          <Card size="small" styles={{ body: { padding: 0 } }}>
            <Table
              size="small"
              rowKey={(r) =>
                searchMode === 'sbNo'
                  ? `sb-${r.sbNo}-${r.matchId || ''}`
                  : `inv-${r.invoice}-${r.matchId || ''}`
              }
              loading={loading}
              columns={columns}
              dataSource={rows}
              scroll={{ x: 'max-content' }}
              expandable={{
                expandedRowKeys,
                onExpandedRowsChange: setExpandedRowKeys,
                expandedRowRender,
              }}
              pagination={{
                current: page,
                pageSize,
                total,
                showSizeChanger: true,
                pageSizeOptions: ['10', '20', '50', '100'],
                showTotal: (t) =>
                  `${t} unique ${searchMode === 'invoice' ? 'invoices' : 'SB Nos'}`,
                onChange: (p, size) => {
                  setPage(p)
                  setPageSize(size)
                },
              }}
              locale={{
                emptyText:
                  searchMode === 'invoice'
                    ? 'No unique invoices for this search'
                    : 'No unique SB Nos for this search',
              }}
            />
          </Card>
        ) : (
          <Alert type="info" showIcon message="Select Invoice or SB No, then search to load results." />
        )}
      </Space>
    </AppShell>
  )
}
