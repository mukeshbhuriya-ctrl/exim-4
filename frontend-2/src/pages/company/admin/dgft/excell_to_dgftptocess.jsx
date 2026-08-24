import { DownloadOutlined, SendOutlined, UploadOutlined } from '@ant-design/icons'
import { Button, Card, Layout, Select, Space, Table, Tag, Typography, Upload, message } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography

const FETCH_USING_OPTIONS = [
  { value: 'dricat', label: 'dricat' },
  { value: 'selenium', label: 'selenium' },
]

const MONTH_MAP = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

function toText(value) {
  return String(value ?? '').trim()
}

/** Avoid scientific notation and JS float rounding for whole numbers from Excel. */
function excelValueToText(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    const intVal = Math.round(value)
    if (Math.abs(intVal - value) < 1e-9) {
      return intVal.toLocaleString('en-US', { maximumFractionDigits: 0, useGrouping: false })
    }
    return String(value)
  }
  const s = toText(value)
  if (/^[\d.]+[eE][+-]?\d+$/.test(s)) {
    const n = Number(s)
    if (Number.isFinite(n)) {
      return Math.round(n).toLocaleString('en-US', { maximumFractionDigits: 0, useGrouping: false })
    }
  }
  return s
}

/** Prefer Excel displayed text (`w`) so long SB numbers are not rounded. */
function cellDisplayText(cell) {
  if (!cell) return ''
  if (cell.w != null && String(cell.w).trim() !== '') {
    return String(cell.w).trim()
  }
  if (cell.t === 's') return toText(cell.v)
  if (cell.t === 'n' && typeof cell.v === 'number') {
    return excelValueToText(cell.v)
  }
  return excelValueToText(cell.v)
}

function sheetToObjectRows(sheet) {
  if (!sheet?.['!ref']) return []
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const headerRow = range.s.r

  const headers = []
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRow, c })
    const header = cellDisplayText(sheet[addr]) || `Column${c + 1}`
    headers.push(header)
  }

  const rows = []
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const row = {}
    let hasValue = false
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const text = cellDisplayText(sheet[addr])
      if (text) hasValue = true
      row[headers[c - range.s.c]] = text
    }
    if (hasValue) rows.push(row)
  }
  return rows
}

function normalizeFetchUsing(value) {
  const v = String(value || '').trim().toLowerCase()
  return v === 'selenium' ? 'selenium' : 'dricat'
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function normalizeYmd(y, m, d) {
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return ''
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return ''
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`
}

function normalize2DigitYear(yy) {
  const n = Number(yy)
  if (!Number.isInteger(n)) return NaN
  return n <= 69 ? 2000 + n : 1900 + n
}

/**
 * Parse 1/2/25, 11/26/25, 07/01/2025, etc.
 * - If one part > 12, that part is the day (other is month).
 * - If both <= 12, treat as DD/MM (Indian SB default).
 * - Excel US exports like 11/26/25 → month 11, day 26.
 */
function parseSlashOrDashDate(p1, p2, yearPart) {
  const a = Number(p1)
  const b = Number(p2)
  const year =
    String(yearPart).length <= 2 ? normalize2DigitYear(yearPart) : Number(yearPart)
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(year)) return ''

  let day
  let month

  if (a > 12 && b >= 1 && b <= 12) {
    day = a
    month = b
  } else if (b > 12 && a >= 1 && a <= 12) {
    month = a
    day = b
  } else if (a >= 1 && a <= 12 && b >= 1 && b <= 12) {
    day = a
    month = b
  } else {
    return ''
  }

  return normalizeYmd(year, month, day)
}

function normalizeSbDateToIso(raw) {
  if (raw === null || raw === undefined || raw === '') return ''
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const parsed = XLSX.SSF?.parse_date_code(raw)
    if (parsed?.y && parsed?.m && parsed?.d) {
      return normalizeYmd(parsed.y, parsed.m, parsed.d)
    }
    return ''
  }
  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    return normalizeYmd(raw.getFullYear(), raw.getMonth() + 1, raw.getDate())
  }

  const s = toText(raw)
  if (!s) return ''

  if (/^\d{4,6}$/.test(s)) {
    const serial = Number(s)
    const parsed = XLSX.SSF?.parse_date_code(serial)
    if (parsed?.y && parsed?.m && parsed?.d) {
      return normalizeYmd(parsed.y, parsed.m, parsed.d)
    }
  }

  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s)
  if (ymd) return normalizeYmd(ymd[1], ymd[2], ymd[3])

  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s)
  if (slash) {
    const iso = parseSlashOrDashDate(slash[1], slash[2], slash[3])
    if (iso) return iso
  }

  const dMon = /^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})$/i.exec(s)
  if (dMon) {
    const month = MONTH_MAP[String(dMon[2]).toLowerCase()]
    const yearRaw = String(dMon[3])
    const year = yearRaw.length === 2 ? normalize2DigitYear(yearRaw) : Number(yearRaw)
    if (month) return normalizeYmd(year, month, dMon[1])
  }

  const dmyNum = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s)
  if (dmyNum) {
    return normalizeYmd(dmyNum[3], dmyNum[2], dmyNum[1])
  }

  return ''
}

/** Always send DD/MM/YYYY to match DGFT backend (e.g. 26/11/2025). */
function formatSbDateForPayload(raw) {
  const iso = normalizeSbDateToIso(raw)
  if (!iso) return toText(raw)
  const [y, m, d] = iso.split('-')
  return `${pad2(d)}/${pad2(m)}/${y}`
}

const SB_NO_KEYS = ['sbnumber', 'sbno', 'shippingbillnumber', 'shippingbillno']

function getValueByKeys(row, keys) {
  const useExcelText = keys === SB_NO_KEYS
  for (const [k, v] of Object.entries(row || {})) {
    const norm = toText(k).toLowerCase().replace(/[^a-z0-9]/g, '')
    if (keys.includes(norm)) {
      return useExcelText ? excelValueToText(v) : v
    }
  }
  return ''
}

function parseExcelBuffer(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: false, cellNF: true })
  const firstName = wb.SheetNames[0]
  const sheet = firstName ? wb.Sheets[firstName] : null
  if (!sheet) return { sheetName: '', rawRows: [], bills: [] }

  const rawRows = sheetToObjectRows(sheet)
  const bills = rawRows
    .map((row, index) => {
      const sbLocation = toText(
        getValueByKeys(row, [
          'port',
          'portcode',
          'shippingbillport',
          'sblocation',
          'sbport',
        ]),
      )
      const sbNo = toText(
        getValueByKeys(row, SB_NO_KEYS),
      )
      const sbDate = formatSbDateForPayload(
        getValueByKeys(row, ['sbdate', 'shippingbilldate', 'date']),
      )
      return {
        key: `bill-${index}`,
        sbNo,
        sbDate,
        sbLocation,
        valid: Boolean(sbNo && sbDate && sbLocation),
      }
    })
    .filter((row) => row.sbNo || row.sbDate || row.sbLocation)

  return { sheetName: firstName, rawRows, bills }
}

async function downloadBlobResponse(res, fallbackName) {
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function buildRequestPayload(bills, fetchUsing) {
  return {
    fetchUsing: normalizeFetchUsing(fetchUsing),
    bills: bills
      .filter((row) => row.valid)
      .map((row) => ({
        sbNo: row.sbNo,
        sbDate: row.sbDate,
        sbLocation: row.sbLocation,
      })),
  }
}

export default function CompanyAdminDgftExcelToProcessPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [fileList, setFileList] = useState([])
  const [sheetName, setSheetName] = useState('')
  const [rawRows, setRawRows] = useState([])
  const [bills, setBills] = useState([])
  const [fetchUsing, setFetchUsing] = useState('dricat')
  const [parsing, setParsing] = useState(false)
  const [downloadingTemplate, setDownloadingTemplate] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [lastResponse, setLastResponse] = useState(null)

  const validBills = useMemo(() => bills.filter((row) => row.valid), [bills])
  const invalidCount = bills.length - validBills.length

  const requestPreview = useMemo(
    () => buildRequestPayload(bills, fetchUsing),
    [bills, fetchUsing],
  )

  const rawColumns = useMemo(() => {
    const keys = new Set()
    for (const row of rawRows) {
      if (row && typeof row === 'object') {
        Object.keys(row).forEach((k) => keys.add(k))
      }
    }
    return Array.from(keys).map((k) => ({
      title: k,
      dataIndex: k,
      key: k,
      ellipsis: true,
      render: (v) => (v == null || v === '' ? '—' : excelValueToText(v)),
    }))
  }, [rawRows])

  const billColumns = useMemo(
    () => [
      { title: 'SB No', dataIndex: 'sbNo', key: 'sbNo', width: 140 },
      { title: 'SB Date', dataIndex: 'sbDate', key: 'sbDate', width: 140 },
      { title: 'SB Location', dataIndex: 'sbLocation', key: 'sbLocation', width: 140 },
      {
        title: 'Status',
        key: 'status',
        width: 100,
        render: (_, record) =>
          record.valid ? <Tag color="green">OK</Tag> : <Tag color="red">Invalid</Tag>,
      },
    ],
    [],
  )

  const resetParsed = useCallback(() => {
    setSheetName('')
    setRawRows([])
    setBills([])
    setLastResponse(null)
  }, [])

  const handleParseFile = useCallback(async (file) => {
    if (!file) return
    setParsing(true)
    resetParsed()
    try {
      const buffer = await file.arrayBuffer()
      const parsed = parseExcelBuffer(buffer)
      setSheetName(parsed.sheetName)
      setRawRows(parsed.rawRows)
      setBills(parsed.bills)
      if (!parsed.rawRows.length) {
        message.warning('No rows found in the first worksheet.')
      } else if (!parsed.bills.filter((b) => b.valid).length) {
        message.warning(
          'Rows found but none are valid. Expected columns like sbNo, sbDate, sbLocation (or port / SB Number / SB Date).',
        )
      } else {
        message.success(`Loaded ${parsed.bills.filter((b) => b.valid).length} bill row(s) from Excel.`)
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to read Excel file')
      resetParsed()
    } finally {
      setParsing(false)
    }
  }, [resetParsed])

  const handleDownloadTemplate = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    setDownloadingTemplate(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/dgft/excel-template`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson?.detail || errJson?.message || `Template download failed (${res.status})`)
      }
      await downloadBlobResponse(res, 'dgft-upload-template.xlsx')
      message.success('Template download started.')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to download template')
    } finally {
      setDownloadingTemplate(false)
    }
  }

  const handleSend = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!validBills.length) {
      message.error('No valid bill rows to send. Upload Excel with sbNo, sbDate, and sbLocation.')
      return
    }

    const body = buildRequestPayload(bills, fetchUsing)
    setSubmitting(true)
    setLastResponse(null)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/dgft/process-dgft-shipping-bill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Request failed (${res.status})`)
      }
      setLastResponse(data)
      if (data?.success === false) {
        message.warning(data?.message || 'Completed with issues')
      } else {
        message.success(data?.message || 'DGFT shipping bills submitted successfully.')
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to send bills to DGFT')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                DGFT Excel → Process
              </Title>
              <Text type="secondary">
                Download the template (columns: <b>Port</b>, <b>SB Number</b>, <b>SB Date</b>). Format{' '}
                <b>SB Number</b> as <b>Text</b> for long values. Dates are normalized to{' '}
                <b>DD/MM/YYYY</b> (e.g. <Text code>11/26/25</Text> → <Text code>26/11/2025</Text>). Upload your
                file, review parsed rows, then send bills as JSON to{' '}
                <Text code>POST /api/company/admin/dgft/process-dgft-shipping-bill</Text>.
              </Text>
            </div>

            <Card size="small">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Space wrap align="center">
                  <Upload
                    accept=".xlsx,.xls,.csv"
                    fileList={fileList}
                    maxCount={1}
                    beforeUpload={() => false}
                    onChange={({ fileList: next }) => {
                      setFileList(next)
                      const file = next[next.length - 1]?.originFileObj
                      if (file) handleParseFile(file)
                      else resetParsed()
                    }}
                  >
                    <Button icon={<UploadOutlined />} loading={parsing}>
                      Choose Excel File
                    </Button>
                  </Upload>

                  <Button
                    icon={<DownloadOutlined />}
                    loading={downloadingTemplate}
                    disabled={!BACKEND_URL || parsing || submitting}
                    onClick={handleDownloadTemplate}
                  >
                    Download template
                  </Button>

                  <Space align="center" size={8}>
                    <Text type="secondary">Fetch using:</Text>
                    <Select
                      value={fetchUsing}
                      onChange={setFetchUsing}
                      options={FETCH_USING_OPTIONS}
                      style={{ width: 160 }}
                      disabled={submitting || parsing}
                    />
                  </Space>

                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    loading={submitting}
                    disabled={!BACKEND_URL || !validBills.length || parsing}
                    onClick={handleSend}
                  >
                    Send to backend
                  </Button>
                </Space>

                {sheetName ? (
                  <Text type="secondary">
                    Sheet: <Text code>{sheetName}</Text> · Parsed: {bills.length} row(s) · Valid:{' '}
                    {validBills.length}
                    {invalidCount > 0 ? ` · Invalid: ${invalidCount}` : ''}
                  </Text>
                ) : null}
              </Space>
            </Card>

            {bills.length > 0 ? (
              <div style={{ minWidth: 0, maxWidth: '100%', overflowX: 'auto' }}>
                <Title level={5} style={{ marginTop: 0 }}>
                  Parsed bills (sent to API)
                </Title>
                <Table
                  size="small"
                  rowKey="key"
                  columns={billColumns}
                  dataSource={bills}
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                  scroll={{ x: 640 }}
                />
              </div>
            ) : null}

            {rawRows.length > 0 ? (
              <div style={{ minWidth: 0, maxWidth: '100%', overflowX: 'auto' }}>
                <Title level={5} style={{ marginTop: 0 }}>
                  Excel output (first sheet)
                </Title>
                <Table
                  size="small"
                  rowKey={(_, index) => `raw-${index}`}
                  columns={rawColumns}
                  dataSource={rawRows}
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                  scroll={{ x: 'max-content' }}
                />
              </div>
            ) : null}

            {validBills.length > 0 ? (
              <div>
                <Text strong>Request body preview</Text>
                <pre
                  style={{
                    marginTop: 8,
                    background: '#fafafa',
                    border: '1px solid #f0f0f0',
                    borderRadius: 8,
                    padding: 12,
                    overflowX: 'auto',
                    wordBreak: 'break-word',
                  }}
                >
                  {JSON.stringify(requestPreview, null, 2)}
                </pre>
              </div>
            ) : null}

            {lastResponse ? (
              <div>
                <Text strong>Response</Text>
                <pre
                  style={{
                    marginTop: 8,
                    background: '#fafafa',
                    border: '1px solid #f0f0f0',
                    borderRadius: 8,
                    padding: 12,
                    overflowX: 'auto',
                    wordBreak: 'break-word',
                  }}
                >
                  {JSON.stringify(lastResponse, null, 2)}
                </pre>
              </div>
            ) : null}
          </Space>
        </AppShell>
  )
}
