import { ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import { Button, Card, Layout, Select, Space, Table, Tag, Typography, Upload, message } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography

function normalizeBatches(payload) {
  if (Array.isArray(payload?.batches)) return payload.batches
  if (Array.isArray(payload?.data?.batches)) return payload.data.batches
  if (Array.isArray(payload?.rows)) return payload.rows
  return []
}

function normalizeBatchRows(payload) {
  if (Array.isArray(payload?.rows)) return payload.rows
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows
  if (Array.isArray(payload?.data)) return payload.data
  return []
}

function normalizeList(value) {
  if (value == null) return []
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'object') return [value]
  return []
}

function toneByStatus(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'success') return 'success'
  if (s === 'error') return 'error'
  if (s === 'skipped') return 'warning'
  return 'default'
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

export default function CompanyAdminSbBatchPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [fileList, setFileList] = useState([])
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadSummary, setUploadSummary] = useState(null)
  const [fetchUsing, setFetchUsing] = useState('selenium')

  const [batches, setBatches] = useState([])
  const [batchesLoading, setBatchesLoading] = useState(false)

  const [selectedBatchId, setSelectedBatchId] = useState(null)
  const [batchDetail, setBatchDetail] = useState(null)
  const [detailRows, setDetailRows] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchBatches = useCallback(async () => {
    if (!BACKEND_URL) return
    setBatchesLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/sb/batch-process-shipping-batches`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load batches (${res.status})`)
      }
      setBatches(normalizeBatches(data))
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load batches')
      setBatches([])
    } finally {
      setBatchesLoading(false)
    }
  }, [BACKEND_URL])

  const fetchBatchDetail = useCallback(
    async (batchId) => {
      if (!BACKEND_URL || !batchId) return
      setDetailLoading(true)
      setBatchDetail(null)
      setDetailRows([])
      try {
        const params = new URLSearchParams({ id: String(batchId) })
        const res = await fetch(
          `${BACKEND_URL}/api/company/admin/sb/batch-process-shipping-batch-detail?${params}`,
          {
            method: 'GET',
            credentials: 'include',
          },
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.detail || data?.message || `Failed to load batch detail (${res.status})`)
        }
        setBatchDetail(data)
        setDetailRows(normalizeBatchRows(data))
      } catch (e) {
        message.error(e instanceof Error ? e.message : 'Failed to load batch detail')
      } finally {
        setDetailLoading(false)
      }
    },
    [BACKEND_URL],
  )

  useEffect(() => {
    fetchBatches()
  }, [fetchBatches])

  useEffect(() => {
    if (selectedBatchId) fetchBatchDetail(selectedBatchId)
  }, [selectedBatchId, fetchBatchDetail])

  const successRows = useMemo(
    () => detailRows.filter((r) => String(r?.status || '').toLowerCase() === 'success'),
    [detailRows],
  )
  const errorRows = useMemo(
    () => detailRows.filter((r) => String(r?.status || '').toLowerCase() === 'error'),
    [detailRows],
  )

  const onStartBatch = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!fileList.length) {
      message.error('Please choose one Excel file.')
      return
    }
    const file = fileList[0]

    const form = new FormData()
    form.append('excel', file)
    form.append('fetchUsing', normalizeFetchUsing(fetchUsing))

    setUploadLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/sb/batch-process-shipping`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      const uploadData = data?.data && typeof data.data === 'object' ? data.data : {}
      setUploadSummary(uploadData)
      const msg = data?.message || (res.ok ? 'Batch started.' : `Batch request finished (${res.status}).`)
      if (res.ok) message.success(msg)
      else message.warning(msg)

      const batchId = uploadData?.uploadBatchId || uploadData?.batchId
      if (batchId) {
        setSelectedBatchId(String(batchId))
      }
      await fetchBatches()
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to upload and process batch')
    } finally {
      setUploadLoading(false)
    }
  }

  const batchColumns = [
    { title: 'File', dataIndex: 'sourceFileName', key: 'sourceFileName', ellipsis: true },
    { title: 'Total', dataIndex: 'totalRows', key: 'totalRows', width: 80, align: 'right' },
    { title: 'Success', dataIndex: 'successCount', key: 'successCount', width: 80, align: 'right' },
    { title: 'Error', dataIndex: 'errorCount', key: 'errorCount', width: 80, align: 'right' },
    { title: 'Skipped', dataIndex: 'skippedCount', key: 'skippedCount', width: 90, align: 'right' },
    {
      title: 'Action',
      key: 'action',
      width: 110,
      render: (_, r) => (
        <Button size="small" type="link" onClick={() => setSelectedBatchId(String(r?.batchId || ''))}>
          View rows
        </Button>
      ),
    },
  ]

  const successDetailColumns = [
    { title: 'SB No', dataIndex: 'sbNo', key: 'sbNo', ellipsis: true, width: 120 },
    { title: 'SB Date', dataIndex: 'sbDate', key: 'sbDate', ellipsis: true, width: 120 },
    { title: 'SB Location', dataIndex: 'sbLocation', key: 'sbLocation', ellipsis: true, width: 110 },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v) => <Tag color={toneByStatus(v)}>{String(v || '—')}</Tag>,
    },
    {
    },
    { title: 'Row #', dataIndex: 'sheetRowNumber', key: 'sheetRowNumber', width: 90, align: 'right' },
  ]
  const errorDetailColumns = [
    { title: 'SB No', dataIndex: 'sbNo', key: 'sbNo', ellipsis: true, width: 120 },
    { title: 'SB Date', dataIndex: 'sbDate', key: 'sbDate', ellipsis: true, width: 120 },
    { title: 'SB Location', dataIndex: 'sbLocation', key: 'sbLocation', ellipsis: true, width: 110 },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v) => <Tag color={toneByStatus(v)}>{String(v || '—')}</Tag>,
    },
    {
      title: 'Error message',
      dataIndex: 'errorMessage',
      key: 'errorMessage',
      ellipsis: true,
      render: (v) => (v == null || v === '' ? '—' : String(v)),
    },
    { title: 'Row #', dataIndex: 'sheetRowNumber', key: 'sheetRowNumber', width: 90, align: 'right' },
  ]

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
    }),
    [scrapedSubTableColumns],
  )

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="large" style={{ width: '100%', minWidth: 0 }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                SB Batch Process
              </Title>
              <Text type="secondary">
                Upload an Excel file and process SB scraping in sessions. Then inspect batch history and row-level
                results.
              </Text>
            </div>

            <Card title="Upload + Start Batch">
              <Space wrap size="middle" align="end">
                <Space direction="vertical" size={4}>
                  <Text type="secondary">Fetch using</Text>
                  <Select
                    value={fetchUsing}
                    onChange={setFetchUsing}
                    options={FETCH_USING_OPTIONS}
                    style={{ width: 210 }}
                    disabled={uploadLoading}
                  />
                </Space>
                <Upload
                  beforeUpload={(file) => {
                    const lower = String(file.name || '').toLowerCase()
                    const ok = lower.endsWith('.xlsx') || lower.endsWith('.xls')
                    if (!ok) {
                      message.error('Only Excel file is allowed (.xlsx/.xls)')
                      return Upload.LIST_IGNORE
                    }
                    setFileList([file])
                    return false
                  }}
                  onRemove={() => {
                    setFileList([])
                  }}
                  fileList={fileList}
                  maxCount={1}
                >
                  <Button icon={<UploadOutlined />}>Choose Excel</Button>
                </Upload>

                <Button type="primary" loading={uploadLoading} onClick={onStartBatch}>
                  Start Batch
                </Button>
              </Space>

              {uploadSummary ? (
                <div style={{ marginTop: 12 }}>
                  <Text>
                    Batch: <Text code>{String(uploadSummary.uploadBatchId || uploadSummary.batchId || '—')}</Text>
                  </Text>
                  <br />
                  <Text type="secondary">
                    Parsed: {uploadSummary.totalParsedRows ?? '—'} | To scrape: {uploadSummary.toScrape ?? '—'} |
                    Success: {uploadSummary.succeeded ?? '—'} | Failed: {uploadSummary.failed ?? '—'} | Skipped:{' '}
                    {uploadSummary.skippedValidation ?? '—'}
                  </Text>
                </div>
              ) : null}
            </Card>

            <Card
              title="Batch History"
              extra={
                <Button icon={<ReloadOutlined />} onClick={fetchBatches} loading={batchesLoading}>
                  Refresh
                </Button>
              }
            >
              <div style={{ width: '100%', minWidth: 0, overflowX: 'auto' }}>
                <Table
                  size="small"
                  style={{ width: '100%', minWidth: 0 }}
                  rowKey={(r) => String(r?.batchId ?? r?.id ?? '')}
                  loading={batchesLoading}
                  columns={batchColumns}
                  dataSource={batches}
                  pagination={{ pageSize: 10, showSizeChanger: true }}
                  scroll={{ x: 'max-content' }}
                />
              </div>
            </Card>

            <Card
              title="Batch Detail Rows"
              extra={
                <Space>
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => selectedBatchId && fetchBatchDetail(selectedBatchId)}
                    disabled={!selectedBatchId}
                    loading={detailLoading}
                  >
                    Refresh
                  </Button>
                </Space>
              }
            >
              <Text type="secondary">
                Selected batch:{' '}
                <Text code>{selectedBatchId || batchDetail?.batchId || batchDetail?.data?.batchId || '—'}</Text>
              </Text>
              <div style={{ marginTop: 8 }}>
                <Space wrap>
                  <Tag>Success: {successRows.length}</Tag>
                  <Tag color="error">Error: {errorRows.length}</Tag>
                </Space>
              </div>
              <div style={{ width: '100%', minWidth: 0, overflowX: 'auto', marginTop: 10 }}>
                <Text strong>Success rows ({successRows.length})</Text>
                <Table
                  size="small"
                  style={{ width: '100%', minWidth: 0, marginTop: 8 }}
                  rowKey={(r) => String(r?.id ?? `${r?.batchId}-${r?.sheetRowNumber}-${r?.sbNo}`)}
                  loading={detailLoading}
                  columns={successDetailColumns}
                  dataSource={successRows}
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                  scroll={{ x: 'max-content' }}
                  expandable={scrapedExpandable}
                />
              </div>
              <div style={{ width: '100%', minWidth: 0, overflowX: 'auto', marginTop: 16 }}>
                <Text strong>Error rows ({errorRows.length})</Text>
                <Table
                  size="small"
                  style={{ width: '100%', minWidth: 0, marginTop: 8 }}
                  rowKey={(r) => String(r?.id ?? `err-${r?.batchId}-${r?.sheetRowNumber}-${r?.sbNo}`)}
                  loading={detailLoading}
                  columns={errorDetailColumns}
                  dataSource={errorRows}
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                  scroll={{ x: 'max-content' }}
                />
              </div>
            </Card>
          </Space>
        </AppShell>
  )
}
