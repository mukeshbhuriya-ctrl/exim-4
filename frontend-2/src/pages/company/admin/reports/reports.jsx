import { DownloadOutlined, SearchOutlined, DatabaseOutlined, LayoutOutlined, CalendarOutlined, ControlOutlined } from '@ant-design/icons'
import { Button, DatePicker, Dropdown, Layout, Select, Space, Table, Tag, Typography, message, ConfigProvider, Card, Form, Row, Col, Empty, Divider } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'
import ProDataTable from '../../../../components/shared/ProDataTable.jsx'

const { Content } = Layout
const { Title, Text } = Typography

const REPORT_TYPE_OPTIONS = [
  { value: 'sales', label: 'Sales' },
  { value: 'pdf', label: 'PDF' },
  { value: 'shipping', label: 'Shipping bill' },  
  { value: 'dgft', label: 'DGFT' },
  { value: 'cha', label: 'CHA' },
]

const API_REPORT_TYPES = ['pdf', 'sb', 'dgft', 'cha']

const MONTH_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function mapUiTypeToApiType(type) {
  const t = String(type || '').trim().toLowerCase()
  if (t === 'shipping') return 'sb'
  return t
}

function dayjsToSbMonthAndYear(d) {
  if (!d || !dayjs.isDayjs(d) || !d.isValid()) return ''
  return `${MONTH_LABELS[d.month()]}-${d.year()}`
}

function buildApiRowsType(types) {
  const picked = Array.from(new Set((types || []).map(mapUiTypeToApiType).filter((t) => API_REPORT_TYPES.includes(t))))
  if (!picked.length) return null

  // Backend accepts dgft only when shipping bill is included.
  if (picked.includes('dgft') && !picked.includes('sb')) picked.push('sb')

  const order = ['pdf', 'sb', 'dgft', 'cha']
  return order.filter((t) => picked.includes(t)).join(',')
}

function normalizeColumnsPayload(payload) {
  const defaultTypes = REPORT_TYPE_OPTIONS.filter((o) => o.value !== 'sales').map((o) => o.value)
  if (!payload || typeof payload !== 'object') {
    return { types: defaultTypes, columnsByType: {} }
  }
  const types = Array.isArray(payload.type)
    ? payload.type.map((t) => String(t || '').trim().toLowerCase()).filter(Boolean)
    : defaultTypes
  const columnsRaw = payload.columns && typeof payload.columns === 'object' ? payload.columns : {}
  const columnsByType = {}
  for (const [k, v] of Object.entries(columnsRaw)) {
    if (Array.isArray(v)) columnsByType[String(k)] = v.map((x) => String(x))
  }
  return { types, columnsByType }
}

function normalizeTemplatesListPayload(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.data)) return payload.data
    if (payload.data && typeof payload.data === 'object' && Array.isArray(payload.data.templates)) {
      return payload.data.templates
    }
    if (Array.isArray(payload.templates)) return payload.templates
    if (Array.isArray(payload.items)) return payload.items
    if (Array.isArray(payload.results)) return payload.results
  }
  return []
}

function normalizeTemplateDetailsPayload(payload) {
  if (!payload || typeof payload !== 'object') return {}
  if (payload.data && typeof payload.data === 'object') return payload.data
  return payload
}

function normalizeTemplateMappingForUi(mapping) {
  if (!mapping || typeof mapping !== 'object') return {}
  const out = {}
  for (const [rawType, fields] of Object.entries(mapping)) {
    if (!fields || typeof fields !== 'object') continue
    const type = mapUiTypeToApiType(rawType)
    if (!type) continue
    if (!out[type]) out[type] = {}
    for (const [sourceHeader, customHeader] of Object.entries(fields)) {
      const key = String(sourceHeader || '').trim()
      if (!key) continue
      out[type][key] = customHeader == null ? '' : String(customHeader)
    }
  }
  return out
}

function fileNameFromContentDisposition(header) {
  if (!header || typeof header !== 'string') return null
  const star = /filename\*=UTF-8''([^;\n]+)/i.exec(header)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      return star[1].trim()
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(header)
  if (quoted?.[1]) return quoted[1].trim()
  const plain = /filename=([^;\n]+)/i.exec(header)
  if (plain?.[1]) return plain[1].trim().replace(/^"(.*)"$/, '$1')
  return null
}

function normalizeReportRows(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    const inner = payload.data
    if (inner && typeof inner === 'object' && Array.isArray(inner.rows)) return inner.rows
    if (Array.isArray(payload.rows)) return payload.rows
    if (Array.isArray(payload.data)) return payload.data
    if (Array.isArray(payload.items)) return payload.items
    if (Array.isArray(payload.results)) return payload.results
  }
  return []
}

function isAlreadyFlatReportRow(row) {
  if (!row || typeof row !== 'object') return false
  const values = Object.values(row)
  // If no nested object is present, treat row as table-ready flat row.
  const hasNestedObject = values.some((v) => v != null && typeof v === 'object' && !Array.isArray(v))
  return !hasNestedObject
}

/**
 * API rows look like { processMatch, salesRow, pdfRow, merged } with nested `data` / `source`.
 * Flatten into one object per table row so columns are readable.
 */
function flattenReportTableRow(r) {
  if (!r || typeof r !== 'object') return { _value: String(r) }
  const out = {}

  const assignScalar = (prefix, obj) => {
    if (!obj || typeof obj !== 'object') return
    for (const [k, v] of Object.entries(obj)) {
      if (v != null && typeof v === 'object' && !Array.isArray(v)) continue
      out[`${prefix}${k}`] = v
    }
  }

  if (r.processMatch && typeof r.processMatch === 'object') {
    assignScalar('pm_', r.processMatch)
  }

  const embedNested = (block, prefix, dataKey) => {
    if (!block || typeof block !== 'object') return
    for (const [k, v] of Object.entries(block)) {
      if (k === dataKey && v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [dk, dv] of Object.entries(v)) {
          const col = `${prefix}${dk}`
          if (dv != null && typeof dv === 'object' && !Array.isArray(dv)) {
            try {
              out[col] = JSON.stringify(dv)
            } catch {
              out[col] = '[Object]'
            }
          } else {
            out[col] = dv
          }
        }
      } else if (k === 'source' && v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [sk, sv] of Object.entries(v)) {
          out[`${prefix}src_${sk}`] = sv
        }
      } else if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        // skip other nested objects here (handled above)
      } else {
        out[`${prefix}${k}`] = v
      }
    }
  }

  embedNested(r.salesRow, 'sales_', 'data')
  embedNested(r.pdfRow, 'pdf_', 'data')
  embedNested(r.sbRow, 'sb_', 'data')
  embedNested(r.dgftRow, 'dgft_', 'data')
  embedNested(r.chaRow, 'cha_', 'data')

  if (r.merged && typeof r.merged === 'object') {
    for (const [k, v] of Object.entries(r.merged)) {
      if (v != null && typeof v === 'object') {
        try {
          out[`merged_${k}`] = JSON.stringify(v)
        } catch {
          out[`merged_${k}`] = '[Object]'
        }
      } else {
        out[`merged_${k}`] = v
      }
    }
  }

  if (Object.keys(out).length === 0) {
    try {
      out._rowJson = JSON.stringify(r)
    } catch {
      out._rowJson = String(r)
    }
  }

  return out
}

function extractColumnOrderFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null
  const inner = payload.data
  if (inner && typeof inner === 'object' && Array.isArray(inner.columnOrder)) {
    return inner.columnOrder.map((c) => String(c))
  }
  if (Array.isArray(payload.columnOrder)) {
    return payload.columnOrder.map((c) => String(c))
  }
  return null
}

function buildColumnKeys(rows, columnOrder) {
  const MAX_ROWS_TO_SCAN = 50
  const keySet = new Set()
  for (const r of rows.slice(0, MAX_ROWS_TO_SCAN)) {
    if (!r || typeof r !== 'object') continue
    for (const k of Object.keys(r)) keySet.add(k)
  }

  if (Array.isArray(columnOrder) && columnOrder.length) {
    const orderedSet = new Set(columnOrder)
    const extras = Array.from(keySet).filter((k) => !orderedSet.has(k))
    return [...columnOrder, ...extras]
  }

  const groupRank = (k) => {
    if (k.startsWith('pm.')) return 1
    if (k.startsWith('pm_')) return 1
    if (k.startsWith('sales.')) return 2
    if (k.startsWith('sales_')) return 2
    if (k.startsWith('pdf.')) return 3
    if (k.startsWith('pdf_')) return 3
    if (k.startsWith('sb.')) return 4
    if (k.startsWith('sb_')) return 4
    if (k.startsWith('cha_')) return 5
    if (k.startsWith('cha.')) return 5
    if (k.startsWith('merged.')) return 6
    if (k.startsWith('merged_')) return 6
    return 9
  }

  return Array.from(keySet).sort((a, b) => {
    const ga = groupRank(a)
    const gb = groupRank(b)
    if (ga !== gb) return ga - gb
    return a.localeCompare(b)
  })
}

function getTableColumnsFromRows(rows, columnOrder) {
  const first = rows?.[0]
  if (!first || typeof first !== 'object') {
    return [
      {
        title: 'Value',
        dataIndex: 'value',
        key: 'value',
        ellipsis: true,
        render: (v) => (v === null || v === undefined ? '—' : String(v)),
      },
    ]
  }

  const keys = buildColumnKeys(rows, columnOrder)

  return keys.map((k) => ({
    title: k,
    dataIndex: k,
    key: k,
    ellipsis: false,
    onHeaderCell: () => ({
      style: {
        whiteSpace: 'normal',
        wordBreak: 'break-all',
        lineHeight: 1.2,
      },
    }),
    render: (value) => {
      if (value === null || value === undefined) return '—'
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

export default function CompanyAdminReportsPage() {
  const navigate = useNavigate()
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [reportTypes, setReportTypes] = useState([])
  const [availableTypes, setAvailableTypes] = useState(REPORT_TYPE_OPTIONS.map((o) => o.value))
  const [columnsByType, setColumnsByType] = useState({})
  const [selectedColumns, setSelectedColumns] = useState([])
  const [templates, setTemplates] = useState([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [loadingTemplateDetails, setLoadingTemplateDetails] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState(undefined)
  const [templateMapping, setTemplateMapping] = useState({})
  const [loadingColumns, setLoadingColumns] = useState(false)
  const [dateRange, setDateRange] = useState(null)
  const [loadingData, setLoadingData] = useState(false)
  const [loadingExcel, setLoadingExcel] = useState(false)
  const [reportPayload, setReportPayload] = useState(null)
  const [reportRows, setReportRows] = useState([])
  const [tableRefreshKey, setTableRefreshKey] = useState(0)

  useEffect(() => {
    setTableRefreshKey((prev) => prev + 1)
  }, [reportRows])

  const fetchReportDataForTable = useCallback(async ({ page, limit, search }) => {
    let filtered = reportRows
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
  }, [reportRows])

  const fetchColumnsConfig = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoadingColumns(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/report/columns`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load report columns (${res.status})`)
      }
      const normalized = normalizeColumnsPayload(data)
      const effectiveTypes = normalized.types.length
        ? normalized.types
        : REPORT_TYPE_OPTIONS.map((o) => o.value)
      setAvailableTypes(effectiveTypes)
      setColumnsByType(normalized.columnsByType)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load report columns')
    } finally {
      setLoadingColumns(false)
    }
  }, [BACKEND_URL])

  useEffect(() => {
    fetchColumnsConfig()
  }, [fetchColumnsConfig])

  const fetchTemplates = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoadingTemplates(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/report/templates`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load templates (${res.status})`)
      }
      const rows = normalizeTemplatesListPayload(data).filter((x) => x && typeof x === 'object')
      setTemplates(rows)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load templates')
    } finally {
      setLoadingTemplates(false)
    }
  }, [BACKEND_URL])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const handleTemplateChange = useCallback(
    async (templateId) => {
      setSelectedTemplateId(templateId || undefined)
      setTemplateMapping({})
      setSelectedColumns([])

      if (!BACKEND_URL || !templateId) return

      setLoadingTemplateDetails(true)
      try {
        const res = await fetch(`${BACKEND_URL}/api/company/admin/report/template-by-id`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: templateId }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.detail || data?.message || `Failed to load template details (${res.status})`)
        }
        const template = normalizeTemplateDetailsPayload(data)
        const mapping = normalizeTemplateMappingForUi(template.mapping)
        setTemplateMapping(mapping)

        // Pre-select all mapped template columns (can be adjusted by user later).
        const mapped = []
        for (const [type, fields] of Object.entries(mapping)) {
          if (!fields || typeof fields !== 'object') continue
          for (const sourceHeader of Object.keys(fields)) {
            mapped.push(`${type}::${sourceHeader}`)
          }
        }
        setSelectedColumns(Array.from(new Set(mapped)))
        
        let nextTypes = []
        if (Array.isArray(template.type) && template.type.length > 0) {
          nextTypes = template.type
        } else if (template.mapping && typeof template.mapping === 'object') {
          nextTypes = Object.keys(template.mapping)
        }
        
        if (nextTypes.length > 0) {
          setReportTypes(nextTypes)
        }
        
        message.success('Template loaded.')
      } catch (e) {
        setTemplateMapping({})
        setSelectedColumns([])
        message.error(e instanceof Error ? e.message : 'Failed to load template details')
      } finally {
        setLoadingTemplateDetails(false)
      }
    },
    [BACKEND_URL],
  )

  const reportTypeOptions = useMemo(() => {
    const labelMap = Object.fromEntries(REPORT_TYPE_OPTIONS.map((o) => [o.value, o.label]))
    return availableTypes
      .filter((value) => value !== 'sales')
      .map((value) => ({
        value,
        label: labelMap[value] || value.toUpperCase(),
      }))
  }, [availableTypes])

  const selectedTemplateSummary = useMemo(() => {
    if (!selectedTemplateId) return null
    const found = templates.find((t) => String(t?.id || t?._id || '') === String(selectedTemplateId))
    return {
      id: String(selectedTemplateId),
      name: String(found?.templateName || found?.name || selectedTemplateId),
    }
  }, [selectedTemplateId, templates])

  useEffect(() => {
    if (!availableTypes.length) return
    setReportTypes((prev) => prev.filter((t) => availableTypes.includes(t)))
  }, [availableTypes])

  const activeColumnOptions = useMemo(() => {
    const groups = []
    for (const type of reportTypes) {
      const cols = columnsByType?.[type]
      if (!Array.isArray(cols) || !cols.length) continue
      const templateTypeMapping =
        selectedTemplateId && templateMapping && typeof templateMapping === 'object' ? templateMapping[type] : null
      const allowedByTemplate =
        templateTypeMapping && typeof templateTypeMapping === 'object' ? new Set(Object.keys(templateTypeMapping)) : null
      const strictFilteredCols = allowedByTemplate ? cols.filter((c) => allowedByTemplate.has(c)) : cols
      // Keep dropdown usable even if template keys don't exactly match columns API (case/alias mismatch).
      const filteredCols = strictFilteredCols.length ? strictFilteredCols : cols
      if (!filteredCols.length) continue
      groups.push({
        label: type.toUpperCase(),
        options: filteredCols.map((c) => {
          const renamed = templateTypeMapping?.[c]
          return {
            value: `${type}::${c}`,
            label: renamed && renamed !== c ? `${c} (${renamed})` : c,
          }
        }),
      })
    }
    return groups
  }, [columnsByType, reportTypes, selectedTemplateId, templateMapping])

  const columnMenuItems = useMemo(
    () =>
      activeColumnOptions.map((group) => ({
        key: String(group.label),
        label: String(group.label),
        children: (group.options || []).map((opt) => ({
          key: String(opt.value),
          label: String(opt.label),
        })),
      })),
    [activeColumnOptions],
  )

  const selectedColumnsGrouped = useMemo(() => {
    const grouped = {}
    for (const raw of selectedColumns) {
      const [type, ...rest] = String(raw).split('::')
      const col = rest.join('::')
      if (!type || !col) continue
      if (!grouped[type]) grouped[type] = []
      grouped[type].push(col)
    }
    for (const key of Object.keys(grouped)) {
      grouped[key] = Array.from(new Set(grouped[key]))
    }
    return grouped
  }, [selectedColumns])

  useEffect(() => {
    const valid = new Set(
      activeColumnOptions.flatMap((g) => (Array.isArray(g?.options) ? g.options.map((o) => o.value) : [])),
    )
    setSelectedColumns((prev) => prev.filter((v) => valid.has(v)))
  }, [activeColumnOptions])

  const buildBody = useCallback(() => {
    if (!reportTypes.length) {
      return { error: 'Select at least one report type.' }
    }

    const joinedTypes = buildApiRowsType(reportTypes)
    if (!joinedTypes) {
      const mapped = reportTypes.map((t) => mapUiTypeToApiType(t))
      const unsupported = mapped.filter((t) => !API_REPORT_TYPES.includes(t))
      if (unsupported.length) {
        return { error: `Unsupported report type: ${unsupported.join(', ')}.` }
      }
      return { error: 'Select at least one valid report type (PDF, Shipping bill, DGFT, or CHA).' }
    }

    const [from, to] = dateRange || []
    const fromValid = from && dayjs.isDayjs(from) && from.isValid()
    const toValid = to && dayjs.isDayjs(to) && to.isValid()

    const body = {
      type: joinedTypes,
      rowstype: joinedTypes,
    }

    if (fromValid) body.fromDate = from.format('YYYY-MM-DD')
    if (toValid) body.toDate = to.format('YYYY-MM-DD')

    if (reportTypes.includes('cha')) {
      const monthYear = toValid
        ? dayjsToSbMonthAndYear(to)
        : fromValid
          ? dayjsToSbMonthAndYear(from)
          : ''
      if (monthYear) {
        body.sbMonthAndYear = monthYear
        body.month = monthYear
      }
    }

    if (!selectedTemplateId && selectedColumns.length) {
      const cols = selectedColumns.map((v) => String(v).split('::')[1]).filter(Boolean)
      body.columns = Array.from(new Set(cols))
    }
    if (selectedTemplateId) {
      body.templateId = String(selectedTemplateId)
    }
    return { body }
  }, [reportTypes, dateRange, selectedColumns, selectedTemplateId])

  const handleLoadData = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    const built = buildBody()
    if (built?.error) {
      message.warning(built.error)
      return
    }
    const body = built.body

    setLoadingData(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/report/data`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const msg =
          (data && typeof data === 'object' && (data.detail || data.message)) || `Request failed (${res.status})`
        throw new Error(String(msg))
      }
      setReportPayload(data)
      const raw = normalizeReportRows(data).filter((r) => r && typeof r === 'object')
      setReportRows(raw.map((r) => (isAlreadyFlatReportRow(r) ? r : flattenReportTableRow(r))))
      message.success('Report data loaded.')
    } catch (e) {
      setReportPayload(null)
      setReportRows([])
      message.error(e instanceof Error ? e.message : 'Failed to load report data')
    } finally {
      setLoadingData(false)
    }
  }, [BACKEND_URL, buildBody])

  const handleDownloadExcel = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    const built = buildBody()
    if (built?.error) {
      message.warning(built.error)
      return
    }
    const body = built.body

    setLoadingExcel(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/report/excel`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson?.detail || errJson?.message || `Download failed (${res.status})`)
      }

      const blob = await res.blob()
      const headerName = fileNameFromContentDisposition(res.headers.get('Content-Disposition'))
      const fallbackName = body.fromDate && body.toDate
        ? `report-${body.fromDate}-${body.toDate}.xlsx`
        : body.sbMonthAndYear
          ? `report-${body.sbMonthAndYear}.xlsx`
          : 'report.xlsx'
      const filename = headerName || fallbackName

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      message.success('Excel download started.')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to download Excel')
    } finally {
      setLoadingExcel(false)
    }
  }, [BACKEND_URL, buildBody])

  const columnOrder = useMemo(() => extractColumnOrderFromPayload(reportPayload), [reportPayload])
  const columns = useMemo(() => getTableColumnsFromRows(reportRows, columnOrder), [reportRows, columnOrder])
  const tableScrollX = useMemo(() => 'max-content', [])

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <Space direction="vertical" size={16} style={{ width: '100%', minWidth: 0 }}>

        <PageHeader
          title="Reports"
          description="Build cross-module reports, apply templates, and extract data directly to Excel."
          actions={
            <Button type="default" onClick={() => navigate('/admin/reports/templates')} style={{ borderRadius: 6 }}>
              Manage Templates
            </Button>
          }
        />

        <ConfigProvider
          theme={{
            token: { colorPrimary: '#2563eb', borderRadius: 6, colorText: '#1e293b' },
            components: {
              Input: { colorBgContainer: '#f8fafc', colorBorder: '#cbd5e1', hoverBorderColor: '#94a3b8', activeBorderColor: '#2563eb' },
              Select: { colorBgContainer: '#f8fafc', colorBorder: '#cbd5e1', hoverBorderColor: '#94a3b8', activeBorderColor: '#2563eb' },
              DatePicker: { colorBgContainer: '#f8fafc', colorBorder: '#cbd5e1', hoverBorderColor: '#94a3b8', activeBorderColor: '#2563eb' },
              Table: { headerBg: '#f1f5f9', headerColor: '#334155', headerBorderRadius: 8, borderColor: '#e2e8f0', rowHoverBg: '#f8fafc', cellPaddingBlock: 12 },
              Button: { primaryColor: '#ffffff', colorPrimary: '#2563eb', colorPrimaryHover: '#1d4ed8', colorPrimaryActive: '#1e40af' }
            }
          }}
        >
          <Card
            bordered={false}
            style={{ borderRadius: 12, boxShadow: '0 4px 20px -4px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.02)' }}
            bodyStyle={{ padding: 16 }}
          >
            <Form layout="vertical">
              <Row gutter={24}>
                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item
                    label={<Text style={{ fontSize: 12, fontWeight: 600, color: '#475569', letterSpacing: '0.5px' }}><DatabaseOutlined style={{ marginRight: 6 }} />REPORT DATA SOURCES</Text>}
                    style={{ marginBottom: 12 }}
                  >
                    <Select
                      mode="multiple"
                      allowClear
                      placeholder="Select modules"
                      style={{ width: '100%' }}
                      options={reportTypeOptions}
                      value={reportTypes}
                      onChange={setReportTypes}
                      loading={loadingColumns}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12} md={8} lg={8}>
                  <Form.Item
                    label={<Text style={{ fontSize: 12, fontWeight: 600, color: '#475569', letterSpacing: '0.5px' }}><LayoutOutlined style={{ marginRight: 6 }} />CONFIGURATION TEMPLATE</Text>}
                    style={{ marginBottom: 12 }}
                  >
                    <Select
                      allowClear
                      placeholder="Choose an existing template"
                      style={{ width: '100%' }}
                      loading={loadingTemplates || loadingTemplateDetails}
                      value={selectedTemplateId}
                      options={templates.map((t) => ({
                        value: String(t.id || t._id || ''),
                        label: String(t.templateName || t.name || t.id || t._id || ''),
                      })).filter((opt) => opt.value)}
                      onChange={handleTemplateChange}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item
                    label={<Text style={{ fontSize: 12, fontWeight: 600, color: '#475569', letterSpacing: '0.5px' }}><CalendarOutlined style={{ marginRight: 6 }} />DATE RANGE</Text>}
                    style={{ marginBottom: 12 }}
                  >
                    <DatePicker.RangePicker
                      value={dateRange}
                      onChange={(v) => setDateRange(v)}
                      format="YYYY-MM-DD"
                      allowClear
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12} md={24} lg={4}>
                  <Form.Item
                    label={<Text style={{ fontSize: 12, fontWeight: 600, color: '#475569', letterSpacing: '0.5px' }}><ControlOutlined style={{ marginRight: 6 }} />CUSTOM COLUMNS</Text>}
                    style={{ marginBottom: 12 }}
                  >
                    <Space.Compact style={{ width: '100%' }}>
                      <Dropdown
                        trigger={['click']}
                        disabled={Boolean(selectedTemplateId)}
                        menu={{
                          items: columnMenuItems,
                          selectable: true,
                          multiple: true,
                          selectedKeys: selectedColumns,
                          onSelect: ({ key }) => setSelectedColumns((prev) => (prev.includes(key) ? prev : [...prev, key])),
                          onDeselect: ({ key }) => setSelectedColumns((prev) => prev.filter((k) => k !== key)),
                        }}
                      >
                        <Button
                          loading={loadingColumns || loadingTemplateDetails}
                          disabled={Boolean(selectedTemplateId) || !activeColumnOptions.length}
                          style={{ width: '70%' }}
                        >
                          {selectedColumns.length ? `${selectedColumns.length} Selected` : 'Choose'}
                        </Button>
                      </Dropdown>
                      <Button onClick={() => setSelectedColumns([])} disabled={Boolean(selectedTemplateId) || !selectedColumns.length} style={{ width: '30%' }}>
                        Clear
                      </Button>
                    </Space.Compact>
                  </Form.Item>
                </Col>
              </Row>
            </Form>

            {selectedTemplateSummary ? (
              <div style={{ padding: '8px 12px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0', display: 'inline-block', marginBottom: 12 }}>
                <Space size="small">
                  <Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>Active Template:</Text>
                  <Tag color="blue" style={{ margin: 0, fontSize: 12 }}>{selectedTemplateSummary.name}</Tag>
                </Space>
              </div>
            ) : null}

            {selectedColumns.length && !selectedTemplateId ? (
              <div style={{ padding: '12px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0', marginBottom: 12 }}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
                  Active Column Mappings
                </Text>
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  {Object.entries(selectedColumnsGrouped).map(([type, cols]) => (
                    <div key={type} style={{ display: 'flex', alignItems: 'flex-start' }}>
                      <Text style={{ width: 80, fontSize: 11, color: '#64748b', marginTop: 4, fontWeight: 600 }}>
                        {(REPORT_TYPE_OPTIONS.find((o) => o.value === type)?.label || type).toUpperCase()}:
                      </Text>
                      <Space size={[4, 4]} wrap style={{ flex: 1 }}>
                        {cols.map((col) => (
                          <Tag key={`${type}-${col}`} style={{ color: '#334155', border: '1px solid #cbd5e1', background: '#ffffff', fontSize: 11 }}>{col}</Tag>
                        ))}
                      </Space>
                    </div>
                  ))}
                </Space>
              </div>
            ) : null}

            <Divider style={{ margin: '8px 0 16px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Configure the parameters above and load the data grid before exporting.
              </Text>
              <Space size="middle">
                <Button icon={<DownloadOutlined />} loading={loadingExcel} onClick={handleDownloadExcel} style={{ borderRadius: 6, fontWeight: 500 }}>
                  Export to Excel
                </Button>
                <Button type="primary" icon={<SearchOutlined />} loading={loadingData} onClick={handleLoadData} style={{ borderRadius: 6, fontWeight: 500, boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)' }}>
                  Load Data Grid
                </Button>
              </Space>
            </div>
          </Card>

          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 400, marginTop: 16 }}>
            {reportRows.length > 0 ? (
              <div style={{ animation: 'fadeIn 0.3s' }}>
                <ProDataTable
                  columns={columns}
                  fetchData={fetchReportDataForTable}
                  refreshKey={tableRefreshKey}
                  rowKey={(r) => String(r?.pm_id ?? r?.sales_rowId ?? r?.pdf_pdfRowId ?? Math.random())}
                  globalSearchPlaceholder="Search report data..."
                  showSelectionColumn={false}
                  customToolbarActions={
                    reportPayload && typeof reportPayload === 'object' && reportPayload.data && typeof reportPayload.data === 'object' ? (
                      <Space size="middle">
                        {reportPayload.data.rowstype != null && (
                          <Text style={{ fontSize: 12, color: '#64748b' }}>
                            <span style={{ fontWeight: 600 }}>Sources:</span> {String(reportPayload.data.rowstype).toUpperCase()}
                          </Text>
                        )}
                        {reportPayload.data.fromDate != null && reportPayload.data.toDate != null && (
                          <Text style={{ fontSize: 12, color: '#64748b' }}>
                            <span style={{ fontWeight: 600 }}>Period:</span> {String(reportPayload.data.fromDate)} → {String(reportPayload.data.toDate)}
                          </Text>
                        )}
                      </Space>
                    ) : null
                  }
                />
              </div>
            ) : reportPayload != null ? (
              <pre
                style={{
                  margin: 0,
                  padding: 16,
                  background: '#ffffff',
                  borderRadius: 12,
                  boxShadow: '0 4px 20px -4px rgba(0,0,0,0.05)',
                  border: '1px solid #f1f5f9',
                  overflow: 'auto',
                  maxHeight: 480,
                  fontSize: 12,
                  color: '#475569',
                  animation: 'fadeIn 0.3s'
                }}
              >
                {JSON.stringify(reportPayload, null, 2)}
              </pre>
            ) : (
              <Card bordered={false} style={{ borderRadius: 12, background: '#ffffff', border: '1px dashed #cbd5e1', boxShadow: '0 4px 20px -4px rgba(0,0,0,0.02)' }} bodyStyle={{ padding: '80px 24px', textAlign: 'center' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 72, height: 72, borderRadius: '50%', background: '#eff6ff', marginBottom: 24 }}>
                  <DatabaseOutlined style={{ fontSize: 32, color: '#3b82f6' }} />
                </div>
                <Typography.Title level={4} style={{ margin: 0, color: '#0f172a', fontWeight: 600, letterSpacing: '-0.01em' }}>
                  Ready to Extract Data
                </Typography.Title>
                <Typography.Text style={{ display: 'block', marginTop: 12, color: '#64748b', fontSize: 14, maxWidth: 450, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
                  Select your data sources, apply a template, and choose your custom columns. Click <strong style={{ color: '#334155', fontWeight: 600 }}>Load Data Grid</strong> to preview your generated report before exporting to Excel.
                </Typography.Text>
              </Card>
            )}
          </div>
        </ConfigProvider>
      </Space>
    </AppShell>
  )
}
