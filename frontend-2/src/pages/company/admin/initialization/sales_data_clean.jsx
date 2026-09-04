import { InboxOutlined, FileExcelOutlined, CloudUploadOutlined, SaveOutlined, ReloadOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons'
import { Button, Checkbox, InputNumber, Select, Space, Table, Typography, Upload, Input, message } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'
import { AccessControl } from '../../../../components/iam/AccessControl.jsx'

const { Title, Text } = Typography
const { Dragger } = Upload

const TYPE_OPTIONS = [
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'word', label: 'Word' },
]

const REMOVE_DIGIT_SIDE_OPTIONS = [
  { value: 'first', label: 'First' },
  { value: 'last', label: 'Last' },
]

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)

function excelSerialToDate(serial) {
  const n = Number(serial)
  if (!Number.isFinite(n)) return null
  const ms = EXCEL_EPOCH_MS + Math.round(n * 86400000)
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d
}

function isReasonableDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return false
  const y = d.getFullYear()
  return y >= 1990 && y <= 2100
}

function isLikelyDateString(text) {
  const s = String(text ?? '').trim()
  if (!s) return false

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s)
    return isReasonableDate(d)
  }

  const dmy =
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s) ||
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\s/.exec(s)
  if (dmy) {
    const day = Number(dmy[1])
    const month = Number(dmy[2])
    let year = Number(dmy[3])
    if (year < 100) year += year >= 70 ? 1900 : 2000
    const d = new Date(year, month - 1, day)
    return isReasonableDate(d) && d.getDate() === day && d.getMonth() === month - 1
  }

  const parsed = Date.parse(s)
  if (!Number.isNaN(parsed)) {
    return isReasonableDate(new Date(parsed))
  }

  return false
}

function detectValueType(value) {
  if (value === null || value === undefined || value === '') return 'word'

  if (value instanceof Date) {
    return isReasonableDate(value) ? 'date' : 'word'
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const asDate = excelSerialToDate(value)
    if (asDate && isReasonableDate(asDate) && value >= 20000 && value < 80000) {
      return 'date'
    }
    return 'number'
  }

  const text = String(value).trim()
  if (!text) return 'word'

  const normalizedNumber = text.replace(/,/g, '')
  if (/^-?\d+(\.\d+)?$/.test(normalizedNumber)) {
    const n = Number(normalizedNumber)
    const asDate = excelSerialToDate(n)
    if (asDate && isReasonableDate(asDate) && n >= 20000 && n < 80000) {
      return 'date'
    }
    return 'number'
  }

  if (isLikelyDateString(text)) return 'date'

  return 'word'
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatDateDdMmYyyy(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—'
  return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`
}

function parseValueToDate(value) {
  if (value === null || value === undefined || value === '') return null

  if (value instanceof Date) {
    return isReasonableDate(value) ? value : null
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const asDate = excelSerialToDate(value)
    if (asDate && isReasonableDate(asDate) && value >= 20000 && value < 80000) {
      return asDate
    }
    return null
  }

  const text = String(value).trim()
  if (!text) return null

  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(text)) {
    const parts = text.split(/[-/.]/)
    const year = Number(parts[0])
    const month = Number(parts[1])
    const day = Number(parts[2])
    const d = new Date(year, month - 1, day)
    if (isReasonableDate(d) && d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) {
      return d
    }
  }

  const dmy =
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s|T|$)/.exec(text) ||
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\s/.exec(text)
  if (dmy) {
    const day = Number(dmy[1])
    const month = Number(dmy[2])
    let year = Number(dmy[3])
    if (year < 100) year += year >= 70 ? 1900 : 2000
    const d = new Date(year, month - 1, day)
    if (isReasonableDate(d) && d.getDate() === day && d.getMonth() === month - 1) {
      return d
    }
  }

  const normalizedNumber = text.replace(/,/g, '')
  if (/^-?\d+(\.\d+)?$/.test(normalizedNumber)) {
    const n = Number(normalizedNumber)
    const asDate = excelSerialToDate(n)
    if (asDate && isReasonableDate(asDate) && n >= 20000 && n < 80000) {
      return asDate
    }
  }

  const parsed = Date.parse(text)
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed)
    return isReasonableDate(d) ? d : null
  }

  return null
}

function formatSampleValue(value, type) {
  if (value === null || value === undefined || value === '') return '—'

  if (type === 'date') {
    const d = parseValueToDate(value)
    return d ? formatDateDdMmYyyy(d) : String(value)
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateDdMmYyyy(value)
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const asDate = excelSerialToDate(value)
    if (asDate && isReasonableDate(asDate) && value >= 20000 && value < 80000) {
      return formatDateDdMmYyyy(asDate)
    }
  }
  return String(value)
}

function getRawSampleDisplay(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleString('en-GB')
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const asDate = excelSerialToDate(value)
    if (asDate && isReasonableDate(asDate) && value >= 20000 && value < 80000) {
      return String(value)
    }
  }
  return String(value)
}

function applyColumnTransforms(value, record) {
  const original = getRawSampleDisplay(value)

  if (record.type === 'date') {
    const d = parseValueToDate(value)
    const transformed = d ? formatDateDdMmYyyy(d) : original
    return { original, transformed, changed: Boolean(d) && transformed !== original }
  }

  if (record.removeDigitsEnabled && record.removeDigitsCount) {
    const transformed = applyRemoveDigits(value, record.removeDigitsSide, record.removeDigitsCount)
    return { original, transformed, changed: transformed !== original }
  }

  return { original, transformed: original, changed: false }
}

function applyRemoveDigits(value, side, count) {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  if (!n) return getRawSampleDisplay(value)

  const text = getRawSampleDisplay(value)
  if (text === '—') return text

  const chars = text.split('')
  const digitIndexes = []
  chars.forEach((ch, index) => {
    if (/\d/.test(ch)) digitIndexes.push(index)
  })

  if (!digitIndexes.length) return text

  const indexesToRemove =
    side === 'last' ? digitIndexes.slice(-n) : digitIndexes.slice(0, n)
  const removeSet = new Set(indexesToRemove)

  const cleaned = chars.map((ch, index) => (removeSet.has(index) ? '' : ch)).join('')
  return cleaned || '—'
}

async function parseSalesExcelPreview(file) {
  const arrayBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    throw new Error('No worksheet found in the Excel file.')
  }

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (!rows.length) {
    throw new Error('The Excel file is empty.')
  }

  const headerRow = Array.isArray(rows[0]) ? rows[0] : []
  const sampleRow = Array.isArray(rows[1]) ? rows[1] : []
  const colCount = Math.max(headerRow.length, sampleRow.length, 1)

  const previewRows = []
  for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
    const rawHeader = headerRow[colIndex]
    const header =
      rawHeader === null || rawHeader === undefined || String(rawHeader).trim() === ''
        ? `Column ${colIndex + 1}`
        : String(rawHeader).trim()
    const sampleValue = sampleRow[colIndex] ?? ''
    const type = detectValueType(sampleValue)
    previewRows.push({
      key: `col-${colIndex}`,
      colIndex,
      header,
      sampleValue,
      sampleDisplay: formatSampleValue(sampleValue, type),
      type,
      removeDigitsEnabled: false,
      removeDigitsSide: 'first',
      removeDigitsCount: null,
      requireNotNull: false,
      sum: false,
    })
  }

  return {
    sheetName,
    previewRows,
    totalRows: rows.length,
  }
}

function rowsToApiColumns(rows) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => ({
    columnName: row.header,
    colIndex: row.colIndex ?? index,
    type: row.type || 'word',
    removeDigits: {
      enabled: Boolean(row.removeDigitsEnabled),
      side: row.removeDigitsSide || 'first',
      count: row.removeDigitsCount ?? null,
    },
    requireNotNull: Boolean(row.requireNotNull),
    sum: Boolean(row.sum),
  }))
}

function mergeSavedRulesIntoPreviewRows(previewRows, savedColumns) {
  const byName = new Map(
    (Array.isArray(savedColumns) ? savedColumns : []).map((col) => [
      String(col.columnName || '').trim().toLowerCase(),
      col,
    ]),
  )

  return previewRows.map((row) => {
    const saved = byName.get(String(row.header || '').trim().toLowerCase())
    if (!saved) return row

    const type = saved.type || row.type
    return {
      ...row,
      type,
      sampleDisplay: formatSampleValue(row.sampleValue, type),
      removeDigitsEnabled: Boolean(saved.removeDigits?.enabled),
      removeDigitsSide: saved.removeDigits?.side || 'first',
      removeDigitsCount: saved.removeDigits?.count ?? null,
      requireNotNull: Boolean(saved.requireNotNull),
      sum: Boolean(saved.sum),
    }
  })
}

function savedColumnsToRows(savedColumns) {
  return (Array.isArray(savedColumns) ? savedColumns : []).map((col, index) => ({
    key: `saved-col-${col.colIndex ?? index}`,
    colIndex: col.colIndex ?? index,
    header: col.columnName,
    sampleValue: '',
    sampleDisplay: '—',
    type: col.type || 'word',
    removeDigitsEnabled: Boolean(col.removeDigits?.enabled),
    removeDigitsSide: col.removeDigits?.side || 'first',
    removeDigitsCount: col.removeDigits?.count ?? null,
    requireNotNull: Boolean(col.requireNotNull),
    sum: Boolean(col.sum),
  }))
}

export default function CompanyAdminSalesDataCleanPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')
  const API_BASE = `${BACKEND_URL}/api/company/admin/initialization/sales-data-clean`

  const [fileName, setFileName] = useState('')
  const [sheetName, setSheetName] = useState('')
  const [rows, setRows] = useState([])
  const [parsing, setParsing] = useState(false)
  const [loadingSaved, setLoadingSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [configExists, setConfigExists] = useState(false)
  const [currentView, setCurrentView] = useState('list')
  const [searchTerm, setSearchTerm] = useState('')

  const handleTypeChange = useCallback((key, nextType) => {
    setRows((prev) =>
      prev.map((row) =>
        row.key === key
          ? {
            ...row,
            type: nextType,
            sampleDisplay: formatSampleValue(row.sampleValue, nextType),
          }
          : row,
      ),
    )
  }, [])

  const updateRow = useCallback((key, patch) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }, [])

  const fetchSavedConfig = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoadingSaved(true)
    try {
      const res = await fetch(API_BASE, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Failed to load saved rules (${res.status})`)
      }

      const exists = Boolean(data.exists)
      const savedColumns = data?.salesDataClean?.columns || []
      setConfigExists(exists)
      setRows((prev) => {
        if (!exists || !savedColumns.length || prev.length) return prev
        return savedColumnsToRows(savedColumns)
      })
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load saved cleaning rules')
    } finally {
      setLoadingSaved(false)
    }
  }, [API_BASE, BACKEND_URL])

  useEffect(() => {
    fetchSavedConfig()
  }, [fetchSavedConfig])

  const handleSave = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!rows.length) {
      message.error('Upload a sales Excel file or load saved rules before saving.')
      return
    }

    const payload = { columns: rowsToApiColumns(rows) }
    setSaving(true)
    try {
      const res = await fetch(API_BASE, {
        method: configExists ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 409 && !configExists) {
        setConfigExists(true)
        const retry = await fetch(API_BASE, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const retryData = await retry.json().catch(() => ({}))
        if (!retry.ok) {
          throw new Error(retryData?.message || `Update failed (${retry.status})`)
        }
        setConfigExists(true)
        message.success(retryData?.message || 'Sales data clean rules updated.')
        return
      }

      if (!res.ok) {
        throw new Error(data?.message || `Save failed (${res.status})`)
      }

      setConfigExists(true)
      message.success(data?.message || (configExists ? 'Rules updated.' : 'Rules saved.'))
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save cleaning rules')
    } finally {
      setSaving(false)
    }
  }, [API_BASE, BACKEND_URL, configExists, rows])

  const columns = useMemo(
    () => [
      {
        title: 'Excel header',
        dataIndex: 'header',
        key: 'header',
        width: 240,
        ellipsis: true,
        render: (value) => <Text strong>{value}</Text>,
      },
      {
        title: 'Row 2 sample',
        dataIndex: 'sampleDisplay',
        key: 'sampleDisplay',
        width: 220,
        ellipsis: true,
        render: (_, record) => {
          const { original, transformed, changed } = applyColumnTransforms(
            record.sampleValue,
            record,
          )
          if (!changed) return transformed
          return (
            <Space direction="vertical" size={0}>
              <Text delete type="secondary">
                {original}
              </Text>
              <Text>{transformed}</Text>
            </Space>
          )
        },
      },
      {
        title: 'Type',
        dataIndex: 'type',
        key: 'type',
        width: 140,
        render: (value, record) => (
          <Select
            style={{ width: '100%' }}
            value={value}
            options={TYPE_OPTIONS}
            onChange={(next) => handleTypeChange(record.key, next)}
          />
        ),
      },
      {
        title: 'Remove digits',
        key: 'removeDigits',
        width: 260,
        render: (_, record) => (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Checkbox
              checked={record.removeDigitsEnabled}
              onChange={(e) =>
                updateRow(record.key, {
                  removeDigitsEnabled: e.target.checked,
                  removeDigitsSide: record.removeDigitsSide || 'first',
                  removeDigitsCount: e.target.checked ? record.removeDigitsCount : null,
                })
              }
            >
              Remove digits
            </Checkbox>
            {record.removeDigitsEnabled ? (
              <Space wrap>
                <Select
                  style={{ width: 100 }}
                  value={record.removeDigitsSide || 'first'}
                  options={REMOVE_DIGIT_SIDE_OPTIONS}
                  onChange={(next) => updateRow(record.key, { removeDigitsSide: next })}
                />
                <InputNumber
                  min={1}
                  max={50}
                  placeholder="No."
                  style={{ width: 100 }}
                  value={record.removeDigitsCount}
                  onChange={(next) => updateRow(record.key, { removeDigitsCount: next })}
                />
              </Space>
            ) : null}
          </Space>
        ),
      },
      {
        title: 'Not null',
        key: 'requireNotNull',
        width: 120,
        render: (_, record) => (
          <Checkbox
            checked={Boolean(record.requireNotNull)}
            onChange={(e) => updateRow(record.key, { requireNotNull: e.target.checked })}
          >
            Not null
          </Checkbox>
        ),
      },
      {
        title: 'SUM',
        key: 'sum',
        width: 100,
        render: (_, record) => (
          <Checkbox
            checked={Boolean(record.sum)}
            onChange={(e) => updateRow(record.key, { sum: e.target.checked })}
          >
            SUM
          </Checkbox>
        ),
      },
    ],
    [handleTypeChange, updateRow],
  )

  const handleBeforeUpload = useCallback(async (file) => {
    const lower = String(file.name || '').toLowerCase()
    const isExcel =
      lower.endsWith('.xlsx') ||
      lower.endsWith('.xls') ||
      lower.endsWith('.xlsm') ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel'

    if (!isExcel) {
      message.error(`${file.name} is not an Excel file (.xlsx, .xls, .xlsm).`)
      return Upload.LIST_IGNORE
    }

    setParsing(true)
    try {
      const result = await parseSalesExcelPreview(file)

      let savedColumns = []
      if (BACKEND_URL) {
        try {
          const res = await fetch(API_BASE, { method: 'GET', credentials: 'include' })
          const data = await res.json().catch(() => ({}))
          if (res.ok && data?.salesDataClean?.columns) {
            savedColumns = data.salesDataClean.columns
            setConfigExists(Boolean(data.exists))
          }
        } catch {
          // ignore
        }
      }

      const mergedRows = mergeSavedRulesIntoPreviewRows(result.previewRows, savedColumns)
      setFileName(file.name)
      setSheetName(result.sheetName)
      setRows(mergedRows)
      setCurrentView('list')
      message.success(
        `Loaded ${mergedRows.length} column(s) from "${result.sheetName}" (row 2 used for type detection).`,
      )
    } catch (err) {
      setFileName('')
      setSheetName('')
      setRows([])
      message.error(err instanceof Error ? err.message : 'Failed to read Excel file')
    } finally {
      setParsing(false)
    }

    return false
  }, [API_BASE, BACKEND_URL])

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <style>{`
        .pro-table-antd .ant-table-thead > tr > th {
          background-color: #f8fafc !important;
          color: #64748b !important;
          font-weight: 600 !important;
          font-size: 11px !important;
          text-transform: uppercase !important;
          letter-spacing: 0.5px !important;
          border-bottom: 1px solid var(--exim-border-light) !important;
        }
        .pro-table-antd .ant-table-tbody > tr.pro-table-row > td {
          font-size: 13px !important;
          color: var(--exim-gray-700) !important;
          border-bottom: 1px solid var(--exim-border-light) !important;
          transition: background-color 0.2s ease;
        }
        .pro-table-antd .ant-table-tbody > tr.pro-table-row:hover > td {
          background-color: #f8fafc !important;
        }
      `}</style>
      <PageHeader
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 44, height: 44,
              borderRadius: 12,
              background: 'linear-gradient(135deg, var(--exim-primary) 0%, #60a5fa 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 4px 14px rgba(59, 130, 246, 0.25)',
              border: '1px solid rgba(255,255,255,0.2)'
            }}>
              <FileExcelOutlined style={{ fontSize: 22 }} />
            </div>
            <span style={{ letterSpacing: '-0.5px' }}>Sales Data Clean</span>
          </div>
        }
        description="Upload a sales Excel file. Date columns convert to DD-MM-YYYY (e.g. 03-07-2026). Row 2 is used for preview."
        actions={
          currentView === 'upload' ? (
            <Button onClick={() => setCurrentView('list')} style={{ fontWeight: 500 }}>
              Cancel & Back to Rules
            </Button>
          ) : (
            <AccessControl required="initialization:sales_data_clean:update">
            <Space size={16} split={<div style={{ width: 1, height: 24, background: 'var(--exim-border-light)' }} />}>
              <Button onClick={fetchSavedConfig} loading={loadingSaved} disabled={!BACKEND_URL}>
                Reload Saved
              </Button>
              <Button
                type="primary"
                onClick={handleSave}
                loading={saving}
                disabled={!rows.length || !BACKEND_URL}
              >
                {configExists ? 'Update Rules' : 'Save Rules'}
              </Button>
              <Button
                onClick={() => setCurrentView('upload')}
              >
                Upload Excel
              </Button>
            </Space>
            </AccessControl>
          )
        }
      />

      <div style={{ padding: 0, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {currentView === 'upload' ? (
          <div style={{ background: '#fff', border: '1px solid var(--exim-border-light)', padding: 32, borderRadius: 8, flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Title level={4} style={{ marginTop: 0, marginBottom: 8, color: 'var(--exim-gray-800)' }}>
              Upload Sales Excel
            </Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
              Upload a sample Excel file to parse the headers and configure the data cleaning rules.
            </Text>

            <Dragger
              accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              multiple={false}
              showUploadList={false}
              disabled={parsing}
              beforeUpload={handleBeforeUpload}
              style={{ padding: '40px 16px', background: '#f8fafc', borderColor: '#cbd5e1' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                <CloudUploadOutlined style={{ fontSize: 48, color: 'var(--exim-primary)' }} />
                <div style={{ textAlign: 'center' }}>
                  <p className="ant-upload-text" style={{ fontSize: 16, fontWeight: 500, color: 'var(--exim-gray-800)', margin: 0 }}>
                    Click or drag sales Excel file here
                  </p>
                  <p className="ant-upload-hint" style={{ fontSize: 13, color: 'var(--exim-gray-500)', marginTop: 8, marginBottom: 0 }}>
                    First row = headers, second row = sample for type detection
                  </p>
                </div>
              </div>
            </Dragger>
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {fileName ? (
              <Text type="secondary" style={{ display: 'block', padding: '0 8px' }}>
                Active File: <strong>{fileName}</strong>
                {sheetName ? ` · Sheet: ${sheetName}` : ''}
              </Text>
            ) : null}

            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', background: '#fff', border: '1px solid var(--exim-border-light)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 16px', borderBottom: '1px solid var(--exim-border-light)' }}>
                  <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
                    <Input
                      prefix={<SearchOutlined style={{ color: 'var(--exim-gray-400)' }} />}
                      placeholder="Search Rules..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{ borderRadius: 6, height: 36, fontSize: 12 }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Button icon={<SettingOutlined />} style={{ color: 'var(--exim-gray-600)', borderColor: 'var(--exim-border)', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
                  </div>
                </div>

                <div className="pro-table-antd-container" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
                  <Table
                    rowKey="key"
                    columns={columns}
                    dataSource={(() => {
                      const lower = searchTerm.toLowerCase()
                      return lower ? rows.filter(r => r.header?.toLowerCase().includes(lower)) : rows
                    })()}
                    loading={parsing || loadingSaved}
                    pagination={false}
                    size="small"
                    scroll={{ x: 'max-content', y: 'calc(100vh - 350px)' }}
                    className="pro-table-antd"
                    rowClassName="pro-table-row"
                    locale={{ emptyText: <div style={{ height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--exim-gray-400)', fontWeight: 500 }}>No records found.</div> }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
