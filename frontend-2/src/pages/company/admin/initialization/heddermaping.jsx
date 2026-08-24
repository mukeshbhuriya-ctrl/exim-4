import {
  Button,
  Input,
  Layout,
  message,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
  Upload,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'
import * as XLSX from 'xlsx'

const { Content } = Layout
const { Title, Text } = Typography

const SALES_FIELDS = [
  { key: 'invoiceNumber', label: 'Invoice Number', inputName: 'inv' },
  { key: 'qty1', label: 'Qty 1', inputName: 'qty1' },
  { key: 'qty2', label: 'Qty 2', inputName: 'qty2' },
  { key: 'amount', label: 'Amount', inputName: 'amount' },
]

const PDF_FIELDS = [
  { key: 'invoiceNumber', label: 'Invoice Number', inputName: 'inv' },
  // PDF side removes Qty 2, so we map your single qty output field to `qty1`
  { key: 'qty1', label: 'Qty', inputName: 'qty' },
  { key: 'amount', label: 'Amount', inputName: 'amount' },
]

const JV_FIELDS = [
  { key: 'inv', label: 'INV', inputName: 'INV' },
  { key: 'date', label: 'Date', inputName: 'Date' },
  { key: 'business_area', label: 'Business Area', inputName: 'BUSINESS_AREA' },
]

// Static PDF-side keys from parsed PDF rows (key names only, no values).
const PDF_STATIC_HEADERS = [
  "id.1.INVSN",
  "id.2.ITEMSN",
  "id.3.HS CD",
  "id.4.DESCRIPTION",
  "id.5.QUANTITY",
  "id.6.UQC",
  "id.7.RATE",
  "id.8.VALUE(F/C)",
  "id.9.FOB (INR)",
  "id.10.PMV",
  "id.11.DUTYAMT",
  "id.12.CESS RT",
  "id.13.CESAMT",
  "id.14.DBKCLMD",
  "id.15.IGSTSTAT",
  "id.16.IGST VALUE",
  "id.17.IGST AMOUNT",
  "id.18.SCHCOD",
  "id.19.SCHEME DESCRIPTION",
  "id.20.SQC MSR",
  "id.22.STATE OF ORIGIN",
  "id.23.DISTRICT OF ORIGIN",
  "id.24.PT Abroad",
  "id.25.COMP CESS",
  "id.26.END USE",
  "id.27.FTA BENEFIT AVAILED",
  "id.28.REWARD BENEFIT",
  "id.29.THIRD PARTY ITEM",
  "dbk.1.INV SNO",
  "inv.2.INVOICENO",
  "inv.3.INVOICEAMOUNT",
  "inv.4.CURRENCY",
  "rodtep.1.INVSN",
  "rodtep.2.ITMSN",
  "rodtep.3.QUANTITY",
  "rodtep.4.UQC",
  "rodtep.5.NO.OF UNITS",
  "rodtep.6. VALUE"
]

/** Per-field rounding (API: `rounding.sales`, `rounding.pdf` — keys match column map: inv, qty1, …). */
const ROUNDING_OPTIONS = [
  { value: 'round', label: 'Round' },
  { value: 'round_up', label: 'Round up' },
  { value: 'round_down', label: 'Round down' },
]

const ROUNDING_VALUES = new Set(ROUNDING_OPTIONS.map((o) => o.value))

function normalizeRounding(value) {
  if (value == null || value === '') return 'round'
  if (ROUNDING_VALUES.has(value)) return value
  if (value === 'roundUp') return 'round_up'
  if (value === 'roundDown') return 'round_down'
  const s = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (s === 'round') return 'round'
  if (s === 'round_up' || s === 'roundup' || s === 'ceil') return 'round_up'
  if (s === 'round_down' || s === 'rounddown' || s === 'floor') return 'round_down'
  return 'round'
}

/** Popovers on body avoid clipped hit targets when grid cells overflow. */
function roundingSelectPopupContainer() {
  return document.body
}

/** Prefix so the “use custom text” row never collides with a real header value in `options`. */
function optionText(o) {
  return String(o?.label ?? o?.value ?? '')
}

/**
 * Normal Select: search filters the list; if typed text is not already an option, one extra row
 * appears at the top (“Use …”) so the user picks it from the menu — no tag UI, no auto-adding
 * values to the global suggestion list.
 */
function HeaderSearchSelect({ value, onChange, options: baseOptions, placeholder, disabled }) {
  const [search, setSearch] = useState('')

  const mergedOptions = useMemo(() => {
    const base = baseOptions || []
    const q = search.trim().toLowerCase()

    // Only filter existing headers; unmatched text should not become a selectable value.
    if (!q) return base

    return base.filter((o) => optionText(o).toLowerCase().includes(q))
  }, [baseOptions, search])

  const handleChange = (v) => {
    setSearch('')
    if (v == null || v === '') {
      onChange(undefined)
      return
    }
    onChange(String(v))
  }

  return (
    <Select
      style={{ width: '100%' }}
      placeholder={placeholder}
      value={value ?? undefined}
      onChange={handleChange}
      options={mergedOptions}
      showSearch
      searchValue={search}
      onSearch={setSearch}
      filterOption={false}
      allowClear
      disabled={disabled}
      onOpenChange={(open) => {
        if (!open) setSearch('')
      }}
      getPopupContainer={roundingSelectPopupContainer}
      popupMatchSelectWidth={false}
    />
  )
}

function defaultSalesRounding() {
  return { inv: 'round', qty1: 'round', qty2: 'round', amount: 'round' }
}

function defaultPdfRounding() {
  return { inv: 'round', qty: 'round', amount: 'round' }
}

function newExtraRowId() {
  return `extra-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** Convert extra header rows to a plain object for the API */
function extrasToPayloadObject(rows) {
  const o = {}
  for (const r of rows) {
    const k = (r.key || '').trim()
    const v = (r.value || '').trim()
    if (k && v) o[k] = v
  }
  return o
}

function objectToExtraRows(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return []
  return Object.entries(obj).map(([key, value]) => ({
    id: newExtraRowId(),
    key,
    value: value != null ? String(value) : '',
  }))
}

const FILTER_DATE_MAPPING_URL = '/api/company/admin/report/filter-date-heder-mapping'
const SALES_UNIQUE_COLUMN_URL = '/api/company/admin/header-mapping/sales-uniqe-column'
const FINANCIAL_YEAR_MAPPING_URL = '/api/company/admin/header-mapping/financial-year-header-mapping'
const MANUAL_MATCH_DESCRIPTION_URL = '/api/company/admin/header-mapping/manual-match-description'
const STORE_COLUMN_MAPPING_URL = '/api/company/admin/header-mapping/store-column-mapping'
const GET_COLUMN_MAPPING_URL = '/api/company/admin/header-mapping/get-column-mapping'

/** GET/POST shape: `{ success, manualMatchDescription: { column: "Description" } }` */
function parseManualMatchDescriptionResponse(raw) {
  if (!raw || typeof raw !== 'object') return null

  const manualMatchDescriptionObj =
    raw.manualMatchDescription &&
    typeof raw.manualMatchDescription === 'object' &&
    !Array.isArray(raw.manualMatchDescription)
      ? raw.manualMatchDescription
      : raw.data?.manualMatchDescription &&
          typeof raw.data.manualMatchDescription === 'object'
        ? raw.data.manualMatchDescription
        : raw.headerMapping?.manualMatchDescription &&
            typeof raw.headerMapping.manualMatchDescription === 'object'
          ? raw.headerMapping.manualMatchDescription
          : null

  const column =
    manualMatchDescriptionObj?.column ??
    (typeof raw.column === 'string' ? raw.column : null) ??
    (typeof raw.manualMatchDescription === 'string' ? raw.manualMatchDescription : null)

  if (!column || !String(column).trim()) return null

  const id =
    raw.headerMapping?.id ||
    raw.headerMapping?._id ||
    raw.id ||
    raw._id ||
    raw.mappingId ||
    null

  return { id, column: String(column).trim() }
}

/** GET/POST shape: `{ success, salesUniqeColumn: { columns: ["Invoice No"] } }` */
function parseSalesUniqueColumnResponse(raw) {
  if (!raw || typeof raw !== 'object') return null

  const block =
    raw.salesUniqeColumn && typeof raw.salesUniqeColumn === 'object'
      ? raw.salesUniqeColumn
      : raw.salesUniqueColumn && typeof raw.salesUniqueColumn === 'object'
        ? raw.salesUniqueColumn
        : raw.data?.salesUniqeColumn && typeof raw.data.salesUniqeColumn === 'object'
          ? raw.data.salesUniqeColumn
          : raw.headerMapping?.salesUniqeColumn &&
              typeof raw.headerMapping.salesUniqeColumn === 'object'
            ? raw.headerMapping.salesUniqeColumn
            : null

  let columns = []
  if (Array.isArray(block)) {
    columns = block
  } else if (block && Array.isArray(block.columns)) {
    columns = block.columns
  } else if (Array.isArray(raw.columns)) {
    columns = raw.columns
  }

  columns = [...new Set(columns.map((c) => String(c).trim()).filter(Boolean))]
  if (!columns.length) return null

  const id =
    raw.headerMapping?.id ||
    raw.headerMapping?._id ||
    raw.id ||
    raw._id ||
    raw.mappingId ||
    null

  return { id, columns }
}

/** GET/POST shape: `{ success, filterDate: { date: "Invoice Date" }, headerMapping?: { id } }` */
function parseFilterDateMappingResponse(raw) {
  if (!raw || typeof raw !== 'object') return null

  const filterDateObj =
    raw.filterDate && typeof raw.filterDate === 'object' && !Array.isArray(raw.filterDate)
      ? raw.filterDate
      : raw.data?.filterDate && typeof raw.data.filterDate === 'object'
        ? raw.data.filterDate
        : raw.headerMapping?.filterDate && typeof raw.headerMapping.filterDate === 'object'
          ? raw.headerMapping.filterDate
          : null

  const date =
    filterDateObj?.date ??
    (typeof raw.date === 'string' ? raw.date : null) ??
    (typeof raw.filterDate === 'string' ? raw.filterDate : null)

  if (!date || !String(date).trim()) return null

  const id =
    raw.headerMapping?.id ||
    raw.headerMapping?._id ||
    raw.id ||
    raw._id ||
    raw.mappingId ||
    null

  return { id, date: String(date).trim() }
}

/** GET/POST shape: `{ success, financialYear: { column: "Financial Year" } }` */
function parseFinancialYearMappingResponse(raw) {
  if (!raw || typeof raw !== 'object') return null

  const financialYearObj =
    raw.financialYear && typeof raw.financialYear === 'object' && !Array.isArray(raw.financialYear)
      ? raw.financialYear
      : raw.data?.financialYear && typeof raw.data.financialYear === 'object'
        ? raw.data.financialYear
        : raw.headerMapping?.financialYear &&
            typeof raw.headerMapping.financialYear === 'object'
          ? raw.headerMapping.financialYear
          : null

  const column =
    financialYearObj?.column ??
    (typeof raw.column === 'string' ? raw.column : null) ??
    (typeof raw.financialYear === 'string' ? raw.financialYear : null)

  if (!column || !String(column).trim()) return null

  const id =
    raw.headerMapping?.id ||
    raw.headerMapping?._id ||
    raw.id ||
    raw._id ||
    raw.mappingId ||
    null

  return { id, column: String(column).trim() }
}

/** Canonical keys on `sales` / `pdf` — any other string keys are custom mappings (flat, not nested under `extra`). */
const SALES_RESERVED_KEYS = new Set(['inv', 'qty1', 'qty2', 'amount', 'extra'])
const PDF_RESERVED_KEYS = new Set(['inv', 'qty', 'amount', 'extra'])

const SALES_FORBIDDEN_CUSTOM_KEYS = new Set(['inv', 'qty1', 'qty2', 'amount', 'extra'])
const PDF_FORBIDDEN_CUSTOM_KEYS = new Set(['inv', 'qty', 'amount', 'extra'])

/**
 * @returns {{ sales: Record<string,string>, pdf: Record<string,string>, extraSales: Record<string,string>, extraPdf: Record<string,string>, globalRounding: string | null }}
 */
function parseRoundingBlock(candidate) {
  const sales = defaultSalesRounding()
  const pdf = defaultPdfRounding()
  const extraSales = {}
  const extraPdf = {}
  let globalRounding = null

  const applyScalar = (scalar) => {
    const v = normalizeRounding(scalar)
    globalRounding = v
    Object.keys(sales).forEach((k) => {
      sales[k] = v
    })
    Object.keys(pdf).forEach((k) => {
      pdf[k] = v
    })
  }

  const r = candidate?.rounding

  if (typeof r === 'string' && String(r).trim() !== '') {
    applyScalar(r)
    return { sales, pdf, extraSales, extraPdf, globalRounding }
  }

  if (r && typeof r === 'object' && !Array.isArray(r)) {
    if (r.sales && typeof r.sales === 'object' && !Array.isArray(r.sales)) {
      Object.entries(r.sales).forEach(([k, v]) => {
        if (k === 'extra' || v == null) return
        if (SALES_RESERVED_KEYS.has(k)) {
          sales[k] = normalizeRounding(v)
        } else {
          extraSales[k] = normalizeRounding(v)
        }
      })
    }
    if (r.pdf && typeof r.pdf === 'object' && !Array.isArray(r.pdf)) {
      Object.entries(r.pdf).forEach(([k, v]) => {
        if (k === 'extra' || v == null) return
        if (PDF_RESERVED_KEYS.has(k)) {
          pdf[k] = normalizeRounding(v)
        } else {
          extraPdf[k] = normalizeRounding(v)
        }
      })
    }
    if (!r.sales && !r.pdf) {
      const scalar =
        candidate?.rowRounding ?? candidate?.roundingMode ?? candidate?.quantityRounding
      if (scalar != null && scalar !== '') applyScalar(scalar)
    }
    return { sales, pdf, extraSales, extraPdf, globalRounding }
  }

  const scalar =
    candidate?.rowRounding ?? candidate?.roundingMode ?? candidate?.quantityRounding
  if (scalar != null && scalar !== '') applyScalar(scalar)

  return { sales, pdf, extraSales, extraPdf, globalRounding }
}

/** Load custom rows from API: flat unknown keys + legacy nested `sales.extra` */
function salesRawToExtraRows(sales) {
  if (!sales || typeof sales !== 'object') return []
  const merged = {}
  Object.entries(sales).forEach(([k, v]) => {
    if (SALES_RESERVED_KEYS.has(k)) return
    if (v === undefined || v === null || String(v).trim() === '') return
    merged[k] = v
  })
  if (sales.extra && typeof sales.extra === 'object' && !Array.isArray(sales.extra)) {
    Object.entries(sales.extra).forEach(([k, v]) => {
      if (merged[k] === undefined && v != null && String(v).trim() !== '') merged[k] = v
    })
  }
  return objectToExtraRows(merged)
}

function pdfRawToExtraRows(pdf) {
  if (!pdf || typeof pdf !== 'object') return []
  const merged = {}
  Object.entries(pdf).forEach(([k, v]) => {
    if (PDF_RESERVED_KEYS.has(k)) return
    if (v === undefined || v === null || String(v).trim() === '') return
    merged[k] = v
  })
  if (pdf.extra && typeof pdf.extra === 'object' && !Array.isArray(pdf.extra)) {
    Object.entries(pdf.extra).forEach(([k, v]) => {
      if (merged[k] === undefined && v != null && String(v).trim() !== '') merged[k] = v
    })
  }
  return objectToExtraRows(merged)
}

export default function CompanyAdminUploadPage() {
  const [columnFile, setColumnFile] = useState(null)
  const [sharedColumns, setSharedColumns] = useState([])
  const [columnMappingLoading, setColumnMappingLoading] = useState(false)
  const [columnMappingSaving, setColumnMappingSaving] = useState(false)

  const [salesMapping, setSalesMapping] = useState({
    invoiceNumber: undefined,
    qty1: undefined,
    qty2: undefined,
    amount: undefined,
  })
  const [ocrMapping, setOcrMapping] = useState({
    invoiceNumber: undefined,
    qty1: undefined,
    amount: undefined,
  })
  const [jvMapping, setJvMapping] = useState({
    inv: undefined,
    date: undefined,
    business_area: undefined,
  })

  const [saving, setSaving] = useState(false)
  const [loadingMapping, setLoadingMapping] = useState(false)
  const [mode, setMode] = useState('create') // 'create' | 'update'
  const [existingMappingId, setExistingMappingId] = useState(null)
  const [existingPreview, setExistingPreview] = useState(null)
  const [mappingModalOpen, setMappingModalOpen] = useState(false)
  const [jvMappingModalOpen, setJvMappingModalOpen] = useState(false)

  /** Editable labels for the left column (defaults to API field keys like inv, qty) */
  const [salesLabelOverrides, setSalesLabelOverrides] = useState({})
  const [pdfLabelOverrides, setPdfLabelOverrides] = useState({})
  /** Optional extra mappings: user-defined key + column header */
  const [salesExtras, setSalesExtras] = useState([])
  const [pdfExtras, setPdfExtras] = useState([])
  const [salesRounding, setSalesRounding] = useState(() => defaultSalesRounding())
  const [pdfRounding, setPdfRounding] = useState(() => defaultPdfRounding())
  const [jvSaving, setJvSaving] = useState(false)
  const [jvLoadingMapping, setJvLoadingMapping] = useState(false)
  const [jvMode, setJvMode] = useState('create') // 'create' | 'update'
  const [jvExistingMappingId, setJvExistingMappingId] = useState(null)
  const [jvExistingPreview, setJvExistingPreview] = useState(null)

  const [filterDateColumn, setFilterDateColumn] = useState(undefined)
  const [filterDateModalOpen, setFilterDateModalOpen] = useState(false)
  const [filterDateSaving, setFilterDateSaving] = useState(false)
  const [filterDateLoading, setFilterDateLoading] = useState(false)
  const [filterDateMode, setFilterDateMode] = useState('create')
  const [filterDateExistingId, setFilterDateExistingId] = useState(null)
  const [filterDateExistingPreview, setFilterDateExistingPreview] = useState(null)

  const [salesUniqueColumns, setSalesUniqueColumns] = useState([])
  const [salesUniqueModalOpen, setSalesUniqueModalOpen] = useState(false)
  const [salesUniqueSaving, setSalesUniqueSaving] = useState(false)
  const [salesUniqueLoading, setSalesUniqueLoading] = useState(false)
  const [salesUniqueMode, setSalesUniqueMode] = useState('create')
  const [salesUniqueExistingId, setSalesUniqueExistingId] = useState(null)
  const [salesUniqueExistingPreview, setSalesUniqueExistingPreview] = useState(null)

  const [financialYearColumn, setFinancialYearColumn] = useState(undefined)
  const [financialYearModalOpen, setFinancialYearModalOpen] = useState(false)
  const [financialYearSaving, setFinancialYearSaving] = useState(false)
  const [financialYearLoading, setFinancialYearLoading] = useState(false)
  const [financialYearMode, setFinancialYearMode] = useState('create')
  const [financialYearExistingId, setFinancialYearExistingId] = useState(null)
  const [financialYearExistingPreview, setFinancialYearExistingPreview] = useState(null)

  const [manualMatchDescColumn, setManualMatchDescColumn] = useState(undefined)
  const [manualMatchDescModalOpen, setManualMatchDescModalOpen] = useState(false)
  const [manualMatchDescSaving, setManualMatchDescSaving] = useState(false)
  const [manualMatchDescLoading, setManualMatchDescLoading] = useState(false)
  const [manualMatchDescMode, setManualMatchDescMode] = useState('create')
  const [manualMatchDescExistingId, setManualMatchDescExistingId] = useState(null)
  const [manualMatchDescExistingPreview, setManualMatchDescExistingPreview] = useState(null)

  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  useEffect(() => {
    let mounted = true

    const extractExisting = (raw) => {
      // Try to support multiple possible response shapes.
      const candidate = raw?.data?.mapping || raw?.data || raw?.mapping || raw?.headerMapping || raw
      const id =
        candidate?.id ||
        candidate?._id ||
        candidate?.mappingId ||
        candidate?.headerMappingId ||
        candidate?.mapping_id ||
        null

      const sales = candidate?.sales || candidate?.data?.sales
      const pdf = candidate?.pdf || candidate?.data?.pdf

      if (!sales && !pdf) return null

      // Expected canonical shape:
      // sales: { inv, qty1, qty2, amount }
      // pdf: { inv, qty, amount }
      const salesInv = sales?.inv ?? sales?.invoice ?? sales?.invoiceNumber ?? sales?.invHeader
      const salesQty1 = sales?.qty1 ?? sales?.qty_1 ?? sales?.quantity1
      const salesQty2 = sales?.qty2 ?? sales?.qty_2 ?? sales?.quantity2
      const salesAmount = sales?.amount ?? sales?.totalAmount ?? sales?.amt

      const pdfInv = pdf?.inv ?? pdf?.invoice ?? pdf?.invoiceNumber ?? pdf?.invHeader
      const pdfQty = pdf?.qty ?? pdf?.quantity ?? pdf?.qty1 ?? pdf?.qty_1
      const pdfAmount = pdf?.amount ?? pdf?.totalAmount ?? pdf?.amt

      // If we can't extract anything meaningful, treat as missing.
      if (!salesInv && !salesAmount && !pdfInv && !pdfAmount) return null

      const rb = parseRoundingBlock(candidate)
      const fillExtraRounding = (rows, extraMap, fallback) =>
        rows.map((row) => ({
          ...row,
          rounding:
            extraMap[row.key] != null
              ? normalizeRounding(extraMap[row.key])
              : fallback != null
                ? normalizeRounding(fallback)
                : 'round',
        }))

      const salesExtrasRows = salesRawToExtraRows(sales)
      const pdfExtrasRows = pdfRawToExtraRows(pdf)

      return {
        id,
        salesRounding: rb.sales,
        pdfRounding: rb.pdf,
        sales: { inv: salesInv, qty1: salesQty1, qty2: salesQty2, amount: salesAmount },
        pdf: { inv: pdfInv, qty: pdfQty, amount: pdfAmount },
        salesExtras: fillExtraRounding(salesExtrasRows, rb.extraSales, rb.globalRounding),
        pdfExtras: fillExtraRounding(pdfExtrasRows, rb.extraPdf, rb.globalRounding),
      }
    }

    const fetchExistingMapping = async () => {
      if (!BACKEND_URL) {
        setLoadingMapping(false)
        message.error('Backend URL is not configured (VITE_BACKEND_URL).')
        return
      }
      setLoadingMapping(true)
      setExistingPreview(null)
      setExistingMappingId(null)
      setMode('create')
      setMappingModalOpen(false)

      try {
        // Fetch first so we can show the already-saved mapping.
        // Backend supports GET.
        let res = await fetch(`${BACKEND_URL}/api/company/admin/header-mapping/`, {
          method: 'GET',
          credentials: 'include',
        })

        const data = await res.json().catch(() => ({}))

        if (!res.ok) {
          // If backend returns 404 meaning "not found", we keep create mode.
          if (res.status === 404) {
            setMappingModalOpen(true)
            return
          }
          throw new Error(data?.detail || data?.message || 'Failed to fetch header mapping')
        }

        const extracted = extractExisting(data)
        if (!extracted) {
          setMappingModalOpen(true)
          return
        }

        if (!mounted) return

        setExistingMappingId(extracted.id)
        setExistingPreview(extracted)
        setMode('update')
        setMappingModalOpen(false)
        setSalesRounding(extracted.salesRounding)
        setPdfRounding(extracted.pdfRounding)

        // Pre-fill selections so user sees current mapping once files are uploaded.
        setSalesMapping({
          invoiceNumber: extracted.sales.inv,
          qty1: extracted.sales.qty1,
          qty2: extracted.sales.qty2,
          amount: extracted.sales.amount,
        })

        setOcrMapping({
          invoiceNumber: extracted.pdf.inv,
          qty1: extracted.pdf.qty,
          amount: extracted.pdf.amount,
        })

        setSalesExtras(extracted.salesExtras || [])
        setPdfExtras(extracted.pdfExtras || [])
        setSalesLabelOverrides({})
        setPdfLabelOverrides({})
      } catch (err) {
        // Don't block UI if mapping fetching fails; user can still create.
        // eslint-disable-next-line no-console
        console.warn(err)
        setMappingModalOpen(false)
      } finally {
        if (mounted) setLoadingMapping(false)
      }
    }

    fetchExistingMapping()

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true

    const extractExistingJv = (raw) => {
      const candidate =
        raw?.jvProcess ||
        raw?.data?.jvProcess ||
        raw?.data?.mapping ||
        raw?.data ||
        raw?.mapping ||
        raw?.headerMapping ||
        raw
      const id =
        raw?.id ||
        raw?._id ||
        raw?.mappingId ||
        raw?.headerMappingId ||
        raw?.mapping_id ||
        candidate?.id ||
        candidate?._id ||
        candidate?.mappingId ||
        candidate?.headerMappingId ||
        candidate?.mapping_id ||
        null

      const inv =
        candidate?.inv ??
        candidate?.invoice ??
        candidate?.invoiceNumber ??
        candidate?.jv?.inv ??
        candidate?.jv?.invoice
      const date = candidate?.date ?? candidate?.jvDate ?? candidate?.jv?.date
      const businessArea =
        candidate?.business_area ??
        candidate?.Business_area ??
        candidate?.businessArea ??
        candidate?.BUSINESS_AREA ??
        candidate?.jv?.business_area ??
        candidate?.jv?.businessArea

      if (!inv && !date && !businessArea) return null
      return { id, inv, date, business_area: businessArea }
    }

    const fetchExistingJvMapping = async () => {
      if (!BACKEND_URL) {
        setJvLoadingMapping(false)
        return
      }

      setJvLoadingMapping(true)
      setJvExistingPreview(null)
      setJvExistingMappingId(null)
      setJvMode('create')

      try {
        const res = await fetch(
          `${BACKEND_URL}/api/company/admin/header-mapping/jv-process-header-mapping`,
          {
            method: 'GET',
            credentials: 'include',
          },
        )

        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (res.status === 404) return
          throw new Error(data?.detail || data?.message || 'Failed to fetch JV process header mapping')
        }

        const extracted = extractExistingJv(data)
        if (!extracted || !mounted) return

        setJvExistingMappingId(extracted.id)
        setJvExistingPreview(extracted)
        setJvMode('update')
        setJvMapping({
          inv: extracted.inv || undefined,
          date: extracted.date || undefined,
          business_area: extracted.business_area || undefined,
        })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(err)
      } finally {
        if (mounted) setJvLoadingMapping(false)
      }
    }

    fetchExistingJvMapping()

    return () => {
      mounted = false
    }
  }, [BACKEND_URL])

  const fetchFilterDateMapping = useCallback(async ({ showError = false } = {}) => {
    if (!BACKEND_URL) return null

    setFilterDateLoading(true)
    setFilterDateExistingPreview(null)
    setFilterDateExistingId(null)
    setFilterDateMode('create')
    setFilterDateColumn(undefined)

    try {
      const res = await fetch(`${BACKEND_URL}${FILTER_DATE_MAPPING_URL}`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404) return null
        throw new Error(data?.detail || data?.message || 'Failed to fetch filter date mapping')
      }

      const extracted = parseFilterDateMappingResponse(data)
      if (!extracted) return null

      setFilterDateExistingId(extracted.id)
      setFilterDateExistingPreview(extracted)
      setFilterDateMode('update')
      setFilterDateColumn(extracted.date)
      return extracted
    } catch (err) {
      if (showError) {
        message.error(err instanceof Error ? err.message : 'Failed to fetch filter date mapping')
      } else {
        // eslint-disable-next-line no-console
        console.warn(err)
      }
      return null
    } finally {
      setFilterDateLoading(false)
    }
  }, [BACKEND_URL])

  useEffect(() => {
    fetchFilterDateMapping()
  }, [fetchFilterDateMapping])

  const fetchSalesUniqueColumns = useCallback(async ({ showError = false } = {}) => {
    if (!BACKEND_URL) return null

    setSalesUniqueLoading(true)
    setSalesUniqueExistingPreview(null)
    setSalesUniqueExistingId(null)
    setSalesUniqueMode('create')
    setSalesUniqueColumns([])

    try {
      const res = await fetch(`${BACKEND_URL}${SALES_UNIQUE_COLUMN_URL}`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404) return null
        throw new Error(data?.detail || data?.message || 'Failed to fetch sales unique columns')
      }

      const extracted = parseSalesUniqueColumnResponse(data)
      if (!extracted) return null

      setSalesUniqueExistingId(extracted.id)
      setSalesUniqueExistingPreview(extracted)
      setSalesUniqueMode('update')
      setSalesUniqueColumns(extracted.columns)
      return extracted
    } catch (err) {
      if (showError) {
        message.error(err instanceof Error ? err.message : 'Failed to fetch sales unique columns')
      } else {
        // eslint-disable-next-line no-console
        console.warn(err)
      }
      return null
    } finally {
      setSalesUniqueLoading(false)
    }
  }, [BACKEND_URL])

  useEffect(() => {
    fetchSalesUniqueColumns()
  }, [fetchSalesUniqueColumns])

  const fetchFinancialYearMapping = useCallback(async ({ showError = false } = {}) => {
    if (!BACKEND_URL) return null

    setFinancialYearLoading(true)
    setFinancialYearExistingPreview(null)
    setFinancialYearExistingId(null)
    setFinancialYearMode('create')
    setFinancialYearColumn(undefined)

    try {
      const res = await fetch(`${BACKEND_URL}${FINANCIAL_YEAR_MAPPING_URL}`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404) return null
        throw new Error(data?.detail || data?.message || 'Failed to fetch financial year mapping')
      }

      const extracted = parseFinancialYearMappingResponse(data)
      if (!extracted) return null

      setFinancialYearExistingId(extracted.id)
      setFinancialYearExistingPreview(extracted)
      setFinancialYearMode('update')
      setFinancialYearColumn(extracted.column)
      return extracted
    } catch (err) {
      if (showError) {
        message.error(err instanceof Error ? err.message : 'Failed to fetch financial year mapping')
      } else {
        // eslint-disable-next-line no-console
        console.warn(err)
      }
      return null
    } finally {
      setFinancialYearLoading(false)
    }
  }, [BACKEND_URL])

  useEffect(() => {
    fetchFinancialYearMapping()
  }, [fetchFinancialYearMapping])

  const fetchManualMatchDescriptionMapping = useCallback(async ({ showError = false } = {}) => {
    if (!BACKEND_URL) return null

    setManualMatchDescLoading(true)
    setManualMatchDescExistingPreview(null)
    setManualMatchDescExistingId(null)
    setManualMatchDescMode('create')
    setManualMatchDescColumn(undefined)

    try {
      const res = await fetch(`${BACKEND_URL}${MANUAL_MATCH_DESCRIPTION_URL}`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404) return null
        throw new Error(
          data?.detail || data?.message || 'Failed to fetch manual match description mapping',
        )
      }

      const extracted = parseManualMatchDescriptionResponse(data)
      if (!extracted) return null

      setManualMatchDescExistingId(extracted.id)
      setManualMatchDescExistingPreview(extracted)
      setManualMatchDescMode('update')
      setManualMatchDescColumn(extracted.column)
      return extracted
    } catch (err) {
      if (showError) {
        message.error(
          err instanceof Error ? err.message : 'Failed to fetch manual match description mapping',
        )
      } else {
        // eslint-disable-next-line no-console
        console.warn(err)
      }
      return null
    } finally {
      setManualMatchDescLoading(false)
    }
  }, [BACKEND_URL])

  useEffect(() => {
    fetchManualMatchDescriptionMapping()
  }, [fetchManualMatchDescriptionMapping])

  const fetchColumnMapping = useCallback(async () => {
    if (!BACKEND_URL) return
    setColumnMappingLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}${GET_COLUMN_MAPPING_URL}`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || 'Failed to fetch column mapping')
      }
      const columns = Array.isArray(data?.columns)
        ? data.columns
        : Array.isArray(data?.columnMapping?.columns)
          ? data.columnMapping.columns
          : []
      setSharedColumns(
        [...new Set(columns.map((c) => String(c || '').trim()).filter(Boolean))],
      )
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to fetch column mapping')
    } finally {
      setColumnMappingLoading(false)
    }
  }, [BACKEND_URL])

  useEffect(() => {
    fetchColumnMapping()
  }, [fetchColumnMapping])

  const extractExcelHeaders = async (file) => {
    const arrayBuffer = await file.arrayBuffer()
    const workbook = XLSX.read(arrayBuffer, { type: 'array' })
    const firstSheet = workbook.SheetNames[0]
    const sheet = workbook.Sheets[firstSheet]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })
    const headerRow = rows?.[0] || []

    const headers = headerRow
      .map((h) => (h === null || h === undefined ? '' : String(h).trim()))
      .filter(Boolean)

    // If the sheet doesn't include a header row, fall back to generic columns.
    if (headers.length === 0) {
      const colCount = Math.max((rows?.[0]?.length || 0), (rows?.[1]?.length || 0))
      if (colCount > 0) return Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`)
    }

    return headers
  }

  const handleSharedColumnsBeforeUpload = async (file) => {
    setColumnFile(file)
    setColumnMappingSaving(true)
    try {
      const headers = await extractExcelHeaders(file)
      if (!headers.length) {
        message.error('No column headers found in the Excel file.')
        return false
      }

      if (!BACKEND_URL) {
        message.error('Backend URL is not configured (VITE_BACKEND_URL).')
        return false
      }

      const res = await fetch(`${BACKEND_URL}${STORE_COLUMN_MAPPING_URL}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns: headers }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || 'Failed to store column mapping')
      }

      const saved = Array.isArray(data?.columns)
        ? data.columns
        : Array.isArray(data?.columnMapping?.columns)
          ? data.columnMapping.columns
          : headers
      setSharedColumns(
        [...new Set(saved.map((c) => String(c || '').trim()).filter(Boolean))],
      )
      message.success(`Loaded ${saved.length} columns for all header mappings`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to read/store excel headers')
    } finally {
      setColumnMappingSaving(false)
    }

    return false
  }

  const handleSave = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!sharedColumns.length && mode !== 'update') {
      message.error('Please upload Sales Excel above first to load columns.')
      return
    }

    const missingSales = SALES_FIELDS.some((f) => !String(salesMapping[f.key] || '').trim())
    const missingPdf = PDF_FIELDS.some((f) => !String(ocrMapping[f.key] || '').trim())

    if (missingSales || missingPdf) {
      message.error('Please fill all required Sales headers and PDF columns (default fields are compulsory).')
      return
    }

    const validateExtras = (rows, sideLabel, forbidden) => {
      for (const r of rows) {
        const k = (r.key || '').trim()
        const v = (r.value || '').trim()
        if ((k && !v) || (!k && v)) {
          message.error(
            `${sideLabel}: each extra row needs both a key and a column header, or remove the row.`,
          )
          return false
        }
        if (k && forbidden.has(k.toLowerCase())) {
          message.error(
            `${sideLabel}: custom key "${k}" is reserved — use the default fields above for inv/qty/amount.`,
          )
          return false
        }
      }
      return true
    }
    if (!validateExtras(salesExtras, 'Sales', SALES_FORBIDDEN_CUSTOM_KEYS)) return
    if (!validateExtras(pdfExtras, 'PDF', PDF_FORBIDDEN_CUSTOM_KEYS)) return

    const salesExtraFlat = extrasToPayloadObject(salesExtras)
    const pdfExtraFlat = extrasToPayloadObject(pdfExtras)

    const roundingSales = { ...salesRounding }
    for (const r of salesExtras) {
      const k = (r.key || '').trim()
      if (k && (r.value || '').trim()) {
        roundingSales[k] = r.rounding ?? 'round'
      }
    }
    const roundingPdf = { ...pdfRounding }
    for (const r of pdfExtras) {
      const k = (r.key || '').trim()
      if (k && (r.value || '').trim()) {
        roundingPdf[k] = r.rounding ?? 'round'
      }
    }

    setSaving(true)

    const payload = {
      rounding: {
        sales: roundingSales,
        pdf: roundingPdf,
      },
      sales: {
        inv: salesMapping.invoiceNumber,
        qty1: salesMapping.qty1,
        qty2: salesMapping.qty2,
        amount: salesMapping.amount,
        ...salesExtraFlat,
      },
      pdf: {
        inv: ocrMapping.invoiceNumber,
        qty: ocrMapping.qty1,
        amount: ocrMapping.amount,
        ...pdfExtraFlat,
      },
    }

    try {
      const isUpdate = mode === 'update'
      const body =
        isUpdate && existingMappingId
          ? { ...payload, id: existingMappingId, mappingId: existingMappingId }
          : payload

      const response = await fetch(`${BACKEND_URL}/api/company/admin/header-mapping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data?.detail || data?.message || 'Failed to save header mapping')
      }

      message.success(
        isUpdate ? 'Header mapping updated successfully' : 'Header mapping saved successfully',
      )
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save header mapping')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveJv = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!sharedColumns.length && jvMode !== 'update') {
      message.error('Please upload Sales Excel above first to load columns.')
      return
    }

    const inv = String(jvMapping.inv || '').trim()
    const date = String(jvMapping.date || '').trim()
    const businessArea = String(jvMapping.business_area || '').trim()
    if (!inv || !date || !businessArea) {
      message.error('Please map INV, Date, and Business Area fields for JV process.')
      return
    }

    setJvSaving(true)
    try {
      const isUpdate = jvMode === 'update'
      const payload = {
        inv,
        date,
        business_area: businessArea,
      }
      const body =
        isUpdate && jvExistingMappingId
          ? { ...payload, id: jvExistingMappingId, mappingId: jvExistingMappingId }
          : payload

      const response = await fetch(
        `${BACKEND_URL}/api/company/admin/header-mapping/jv-process-header-mapping`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify(body),
        },
      )

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.detail || data?.message || 'Failed to save JV process header mapping')
      }

      message.success(
        isUpdate
          ? 'JV process header mapping updated successfully'
          : 'JV process header mapping saved successfully',
      )

      const savedId =
        data?.data?.id || data?.id || data?.mappingId || data?.data?.mappingId || jvExistingMappingId
      setJvExistingMappingId(savedId || null)
      setJvExistingPreview({ id: savedId || null, inv, date, business_area: businessArea })
      setJvMode('update')
      setJvMappingModalOpen(false)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save JV process header mapping')
    } finally {
      setJvSaving(false)
    }
  }

  const handleSaveFilterDate = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!sharedColumns.length && filterDateMode !== 'update') {
      message.error('Please upload Sales Excel above first to load columns.')
      return
    }

    const dateColumn = String(filterDateColumn || '').trim()
    if (!dateColumn) {
      message.error('Please select the Sales column to use as filter date for reports.')
      return
    }

    setFilterDateSaving(true)
    try {
      const isUpdate = filterDateMode === 'update'
      const payload = { date: dateColumn }
      const body =
        isUpdate && filterDateExistingId
          ? { ...payload, id: filterDateExistingId, mappingId: filterDateExistingId }
          : payload

      const response = await fetch(`${BACKEND_URL}${FILTER_DATE_MAPPING_URL}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.detail || data?.message || 'Failed to save filter date header mapping')
      }

      message.success(
        isUpdate
          ? 'Filter date header mapping updated successfully'
          : 'Filter date header mapping saved successfully',
      )

      const parsed = parseFilterDateMappingResponse(data) || {
        id: filterDateExistingId,
        date: dateColumn,
      }

      setFilterDateExistingId(parsed.id || null)
      setFilterDateExistingPreview(parsed)
      setFilterDateMode('update')
      setFilterDateColumn(parsed.date)
      setFilterDateModalOpen(false)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save filter date header mapping')
    } finally {
      setFilterDateSaving(false)
    }
  }

  const handleSaveSalesUniqueColumns = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!sharedColumns.length && salesUniqueMode !== 'update') {
      message.error('Please upload Sales Excel above first to load columns.')
      return
    }

    const columns = [...new Set(salesUniqueColumns.map((c) => String(c || '').trim()).filter(Boolean))]
    if (!columns.length) {
      message.error('Select at least one Sales column for unique row identification.')
      return
    }

    setSalesUniqueSaving(true)
    try {
      const isUpdate = salesUniqueMode === 'update'
      const payload = { columns }
      const body =
        isUpdate && salesUniqueExistingId
          ? { ...payload, id: salesUniqueExistingId, mappingId: salesUniqueExistingId }
          : payload

      const response = await fetch(`${BACKEND_URL}${SALES_UNIQUE_COLUMN_URL}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.detail || data?.message || 'Failed to save sales unique columns')
      }

      message.success(
        isUpdate
          ? 'Sales unique column mapping updated successfully'
          : 'Sales unique column mapping saved successfully',
      )

      const parsed = parseSalesUniqueColumnResponse(data) || {
        id: salesUniqueExistingId,
        columns,
      }

      setSalesUniqueExistingId(parsed.id || null)
      setSalesUniqueExistingPreview(parsed)
      setSalesUniqueMode('update')
      setSalesUniqueColumns(parsed.columns)
      setSalesUniqueModalOpen(false)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save sales unique columns')
    } finally {
      setSalesUniqueSaving(false)
    }
  }

  const handleSaveFinancialYear = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!sharedColumns.length && financialYearMode !== 'update') {
      message.error('Please upload Sales Excel above first to load columns.')
      return
    }

    const column = String(financialYearColumn || '').trim()
    if (!column) {
      message.error('Please select the Sales column to use as financial year.')
      return
    }

    setFinancialYearSaving(true)
    try {
      const isUpdate = financialYearMode === 'update'
      const payload = { column }
      const body =
        isUpdate && financialYearExistingId
          ? { ...payload, id: financialYearExistingId, mappingId: financialYearExistingId }
          : payload

      const response = await fetch(`${BACKEND_URL}${FINANCIAL_YEAR_MAPPING_URL}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.detail || data?.message || 'Failed to save financial year header mapping')
      }

      message.success(
        isUpdate
          ? 'Financial year header mapping updated successfully'
          : 'Financial year header mapping saved successfully',
      )

      const parsed = parseFinancialYearMappingResponse(data) || {
        id: financialYearExistingId,
        column,
      }

      setFinancialYearExistingId(parsed.id || null)
      setFinancialYearExistingPreview(parsed)
      setFinancialYearMode('update')
      setFinancialYearColumn(parsed.column)
      setFinancialYearModalOpen(false)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save financial year header mapping')
    } finally {
      setFinancialYearSaving(false)
    }
  }

  const handleSaveManualMatchDescription = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!sharedColumns.length && manualMatchDescMode !== 'update') {
      message.error('Please upload Sales Excel above first to load columns.')
      return
    }

    const column = String(manualMatchDescColumn || '').trim()
    if (!column) {
      message.error('Please select the Sales description column.')
      return
    }

    setManualMatchDescSaving(true)
    try {
      const isUpdate = manualMatchDescMode === 'update'
      const payload = { column }
      const body =
        isUpdate && manualMatchDescExistingId
          ? { ...payload, id: manualMatchDescExistingId, mappingId: manualMatchDescExistingId }
          : payload

      const response = await fetch(`${BACKEND_URL}${MANUAL_MATCH_DESCRIPTION_URL}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          data?.detail || data?.message || 'Failed to save manual match description mapping',
        )
      }

      message.success(
        isUpdate
          ? 'Manual match description mapping updated successfully'
          : 'Manual match description mapping saved successfully',
      )

      const parsed = parseManualMatchDescriptionResponse(data) || {
        id: manualMatchDescExistingId,
        column,
      }

      setManualMatchDescExistingId(parsed.id || null)
      setManualMatchDescExistingPreview(parsed)
      setManualMatchDescMode('update')
      setManualMatchDescColumn(parsed.column)
      setManualMatchDescModalOpen(false)
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : 'Failed to save manual match description mapping',
      )
    } finally {
      setManualMatchDescSaving(false)
    }
  }

  const salesSelectOptions = Array.from(
    new Set([
      ...(sharedColumns || []),
      ...Object.values(salesMapping).filter(Boolean),
      ...salesExtras.map((r) => r.value).filter(Boolean),
    ]),
  ).map((h) => ({ label: h, value: h }))

  const pdfSelectOptions = Array.from(
    new Set([
      ...PDF_STATIC_HEADERS,
      ...Object.values(ocrMapping).filter(Boolean),
      ...pdfExtras.map((r) => r.value).filter(Boolean),
    ]),
  ).map((h) => ({ label: h, value: h }))

  const jvSelectOptions = Array.from(
    new Set([...(sharedColumns || []), ...Object.values(jvMapping).filter(Boolean)]),
  ).map((h) => ({ label: h, value: h }))

  const filterDateSelectOptions = Array.from(
    new Set([...(sharedColumns || []), filterDateColumn].filter(Boolean)),
  ).map((h) => ({ label: h, value: h }))

  const salesUniqueSelectOptions = Array.from(
    new Set([...(sharedColumns || []), ...salesUniqueColumns]),
  ).map((h) => ({ label: h, value: h }))

  const financialYearSelectOptions = Array.from(
    new Set([...(sharedColumns || []), financialYearColumn].filter(Boolean)),
  ).map((h) => ({ label: h, value: h }))

  const manualMatchDescSelectOptions = Array.from(
    new Set([...(sharedColumns || []), manualMatchDescColumn].filter(Boolean)),
  ).map((h) => ({ label: h, value: h }))

  const renderFilterDateMappingForm = (idPrefix, editable = false) => (
    <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Select one <b>Sales</b> column used as the <b>filter date</b> when running reports.
      </Text>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(96px, 120px) minmax(0, 1fr)',
          gap: 8,
          alignItems: 'center',
          width: '100%',
        }}
      >
        <Input value="DATE" readOnly />
        <HeaderSearchSelect
          options={filterDateSelectOptions}
          value={filterDateColumn}
          onChange={(next) => setFilterDateColumn(next ? String(next) : undefined)}
          placeholder="Search or pick filter date column"
          disabled={!editable}
        />
      </div>
    </Space>
  )

  const renderFinancialYearMappingForm = (idPrefix, editable = false) => (
    <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Select the <b>Sales date column</b> used to derive <b>financial year</b> on each row
        (Indian FY: Apr–Mar, e.g. Billing Date 15-Jul-2024 → <code>2024-25</code>).
      </Text>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(96px, 120px) minmax(0, 1fr)',
          gap: 8,
          alignItems: 'center',
          width: '100%',
        }}
      >
        <Input value="DATE COLUMN" readOnly />
        <HeaderSearchSelect
          options={financialYearSelectOptions}
          value={financialYearColumn}
          onChange={(next) => setFinancialYearColumn(next ? String(next) : undefined)}
          placeholder="Search or pick date column (e.g. Billing Date)"
          disabled={!editable}
        />
      </div>
      {!editable && financialYearColumn ? (
        <Tag>{financialYearColumn}</Tag>
      ) : null}
    </Space>
  )

  const renderManualMatchDescriptionForm = (idPrefix, editable = false) => (
    <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Select the <b>Sales description column</b> shown during manual process matching. PDF
        description uses static field <code>id.4.DESCRIPTION</code>.
      </Text>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(96px, 120px) minmax(0, 1fr)',
          gap: 8,
          alignItems: 'center',
          width: '100%',
        }}
      >
        <Input value="DESCRIPTION" readOnly />
        <HeaderSearchSelect
          options={manualMatchDescSelectOptions}
          value={manualMatchDescColumn}
          onChange={(next) => setManualMatchDescColumn(next ? String(next) : undefined)}
          placeholder="Search or pick description column"
          disabled={!editable}
        />
      </div>
      {!editable && manualMatchDescColumn ? <Tag>{manualMatchDescColumn}</Tag> : null}
    </Space>
  )

  const renderSalesUniqueColumnForm = (editable = false) => (
    <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Select one or more <b>Sales</b> columns used together to identify unique rows (e.g. invoice
        number + date).
      </Text>
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
          Unique columns
        </Text>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="Search and pick one or more columns"
          value={salesUniqueColumns}
          onChange={(values) =>
            setSalesUniqueColumns(
              Array.isArray(values) ? values.map((v) => String(v)).filter(Boolean) : [],
            )
          }
          options={salesUniqueSelectOptions}
          showSearch
          allowClear
          disabled={!editable}
          getPopupContainer={roundingSelectPopupContainer}
          popupMatchSelectWidth={false}
        />
      </div>
      {!editable && salesUniqueColumns.length ? (
        <Space wrap size={[8, 8]}>
          {salesUniqueColumns.map((col) => (
            <Tag key={col}>{col}</Tag>
          ))}
        </Space>
      ) : null}
    </Space>
  )

  const renderSalesMappingForm = (idPrefix, allowExtraRowControls = false) => (
    <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Default fields are <b>required</b>. Map each field to a column and choose <b>rounding</b> (inv, qty1,
        qty2, amount, plus any extra keys).{' '}
        {allowExtraRowControls ? (
          <> Add optional rows at the bottom.</>
        ) : (
          <>
            To add or remove extra headers, use <b>Create / Update Header Mapping</b> in the modal.
          </>
        )}
      </Text>
      {SALES_FIELDS.map((f) => (
        <div
          key={`${idPrefix}-sales-${f.key}`}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(72px, 96px) minmax(0, 1fr) minmax(108px, 140px)',
            gap: 8,
            alignItems: 'center',
            width: '100%',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <Input
              value={salesLabelOverrides[f.key] ?? f.inputName}
              onChange={(e) =>
                setSalesLabelOverrides((prev) => ({ ...prev, [f.key]: e.target.value }))
              }
              style={{ textTransform: 'uppercase' }}
              placeholder="Field key"
              readOnly={!allowExtraRowControls}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <HeaderSearchSelect
              options={salesSelectOptions}
              value={salesMapping[f.key]}
              onChange={(next) =>
                setSalesMapping((prev) => ({
                  ...prev,
                  [f.key]: next ? String(next) : undefined,
                }))
              }
              placeholder={`Search or pick ${f.label} header`}
              disabled={!allowExtraRowControls}
            />
          </div>
          <div style={{ minWidth: 0, position: 'relative', zIndex: 2 }}>
            <Select
              size="small"
              value={normalizeRounding(salesRounding[f.inputName])}
              onChange={(v) =>
                setSalesRounding((prev) => ({
                  ...prev,
                  [f.inputName]: v,
                }))
              }
              options={ROUNDING_OPTIONS}
              style={{ width: '100%' }}
              getPopupContainer={roundingSelectPopupContainer}
              popupMatchSelectWidth={false}
              aria-label={`Rounding for ${f.inputName}`}
              disabled={!allowExtraRowControls}
            />
          </div>
        </div>
      ))}
      {salesExtras.map((row) => (
        <div
          key={`${idPrefix}-sales-extra-${row.id}`}
          style={{
            display: 'grid',
            gridTemplateColumns: allowExtraRowControls
              ? 'minmax(72px, 96px) minmax(0, 1fr) minmax(108px, 140px) 40px'
              : 'minmax(72px, 96px) minmax(0, 1fr) minmax(108px, 140px)',
            gap: 8,
            alignItems: 'center',
            width: '100%',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <Input
              value={row.key}
              onChange={(e) =>
                setSalesExtras((prev) =>
                  prev.map((r) => (r.id === row.id ? { ...r, key: e.target.value } : r)),
                )
              }
              placeholder="Custom key"
              readOnly={!allowExtraRowControls}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <HeaderSearchSelect
              options={salesSelectOptions}
              value={row.value || undefined}
              onChange={(next) =>
                setSalesExtras((prev) =>
                  prev.map((r) => (r.id === row.id ? { ...r, value: next ? String(next) : '' } : r)),
                )
              }
              placeholder="Search or pick column"
              disabled={!allowExtraRowControls}
            />
          </div>
          <div style={{ minWidth: 0, position: 'relative', zIndex: 2 }}>
            <Select
              size="small"
              value={normalizeRounding(row.rounding)}
              onChange={(v) =>
                setSalesExtras((prev) =>
                  prev.map((r) => (r.id === row.id ? { ...r, rounding: v } : r)),
                )
              }
              options={ROUNDING_OPTIONS}
              style={{ width: '100%' }}
              getPopupContainer={roundingSelectPopupContainer}
              popupMatchSelectWidth={false}
              aria-label={`Rounding for extra ${row.key || 'new'}`}
              disabled={!allowExtraRowControls}
            />
          </div>
          {allowExtraRowControls ? (
            <Button type="text" danger onClick={() => setSalesExtras((p) => p.filter((r) => r.id !== row.id))}>
              ×
            </Button>
          ) : null}
        </div>
      ))}
      {allowExtraRowControls ? (
        <Button
          type="dashed"
          block
          onClick={() =>
            setSalesExtras((p) => [...p, { id: newExtraRowId(), key: '', value: '', rounding: 'round' }])
          }
        >
          + Add header
        </Button>
      ) : null}
    </Space>
  )

  const renderPdfMappingForm = (idPrefix, allowExtraRowControls = false) => (
    <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Default fields are <b>required</b>. Map PDF columns and set <b>rounding</b> per field (inv, qty,
        amount, extras).{' '}
        {allowExtraRowControls ? (
          <> Add optional rows at the bottom.</>
        ) : (
          <>
            To add or remove extra headers, use <b>Create / Update Header Mapping</b> in the modal.
          </>
        )}
      </Text>
      {PDF_FIELDS.map((f) => (
        <div
          key={`${idPrefix}-pdf-${f.key}`}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(72px, 96px) minmax(0, 1fr) minmax(108px, 140px)',
            gap: 8,
            alignItems: 'center',
            width: '100%',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <Input
              value={pdfLabelOverrides[f.key] ?? f.inputName}
              onChange={(e) =>
                setPdfLabelOverrides((prev) => ({ ...prev, [f.key]: e.target.value }))
              }
              style={{ textTransform: 'uppercase' }}
              placeholder="Field key"
              readOnly={!allowExtraRowControls}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <HeaderSearchSelect
              options={pdfSelectOptions}
              value={ocrMapping[f.key]}
              onChange={(next) =>
                setOcrMapping((prev) => ({
                  ...prev,
                  [f.key]: next ? String(next) : undefined,
                }))
              }
              placeholder={`Search or pick ${f.label} column`}
              disabled={!allowExtraRowControls}
            />
          </div>
          <div style={{ minWidth: 0, position: 'relative', zIndex: 2 }}>
            <Select
              size="small"
              value={normalizeRounding(pdfRounding[f.inputName])}
              onChange={(v) =>
                setPdfRounding((prev) => ({
                  ...prev,
                  [f.inputName]: v,
                }))
              }
              options={ROUNDING_OPTIONS}
              style={{ width: '100%' }}
              getPopupContainer={roundingSelectPopupContainer}
              popupMatchSelectWidth={false}
              aria-label={`Rounding for PDF ${f.inputName}`}
              disabled={!allowExtraRowControls}
            />
          </div>
        </div>
      ))}
      {pdfExtras.map((row) => (
        <div
          key={`${idPrefix}-pdf-extra-${row.id}`}
          style={{
            display: 'grid',
            gridTemplateColumns: allowExtraRowControls
              ? 'minmax(72px, 96px) minmax(0, 1fr) minmax(108px, 140px) 40px'
              : 'minmax(72px, 96px) minmax(0, 1fr) minmax(108px, 140px)',
            gap: 8,
            alignItems: 'center',
            width: '100%',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <Input
              value={row.key}
              onChange={(e) =>
                setPdfExtras((prev) =>
                  prev.map((r) => (r.id === row.id ? { ...r, key: e.target.value } : r)),
                )
              }
              placeholder="Custom key"
              readOnly={!allowExtraRowControls}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <HeaderSearchSelect
              options={pdfSelectOptions}
              value={row.value || undefined}
              onChange={(next) =>
                setPdfExtras((prev) =>
                  prev.map((r) => (r.id === row.id ? { ...r, value: next ? String(next) : '' } : r)),
                )
              }
              placeholder="Search or pick column"
              disabled={!allowExtraRowControls}
            />
          </div>
          <div style={{ minWidth: 0, position: 'relative', zIndex: 2 }}>
            <Select
              size="small"
              value={normalizeRounding(row.rounding)}
              onChange={(v) =>
                setPdfExtras((prev) =>
                  prev.map((r) => (r.id === row.id ? { ...r, rounding: v } : r)),
                )
              }
              options={ROUNDING_OPTIONS}
              style={{ width: '100%' }}
              getPopupContainer={roundingSelectPopupContainer}
              popupMatchSelectWidth={false}
              aria-label={`Rounding for PDF extra ${row.key || 'new'}`}
              disabled={!allowExtraRowControls}
            />
          </div>
          {allowExtraRowControls ? (
            <Button type="text" danger onClick={() => setPdfExtras((p) => p.filter((r) => r.id !== row.id))}>
              ×
            </Button>
          ) : null}
        </div>
      ))}
      {allowExtraRowControls ? (
        <Button
          type="dashed"
          block
          onClick={() =>
            setPdfExtras((p) => [...p, { id: newExtraRowId(), key: '', value: '', rounding: 'round' }])
          }
        >
          + Add header
        </Button>
      ) : null}
    </Space>
  )

  const sectionCardStyle = {
    border: '1px solid #f0f0f0',
    borderRadius: 12,
    padding: 16,
    background: '#fafafa',
    minWidth: 0,
    maxWidth: '100%',
    width: '100%',
  }

  const renderSectionHeader = (title, subtitle, action) => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 12,
        flexWrap: 'wrap',
        marginBottom: action || subtitle ? 12 : 0,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <Title level={5} style={{ margin: 0 }}>
          {title}
        </Title>
        {subtitle ? (
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            {subtitle}
          </Text>
        ) : null}
      </div>
      {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
    </div>
  )

  const renderJvMappingForm = (idPrefix, editable = false) => (
    <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Default fields are <b>required</b>. Map <b>INV</b> and <b>Date</b> from uploaded JV Excel headers.
      </Text>
      {JV_FIELDS.map((f) => (
        <div
          key={`${idPrefix}-jv-${f.key}`}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(72px, 96px) minmax(0, 1fr)',
            gap: 8,
            alignItems: 'center',
            width: '100%',
          }}
        >
          <Input value={f.inputName} readOnly />
          <HeaderSearchSelect
            options={jvSelectOptions}
            value={jvMapping[f.key]}
            onChange={(next) =>
              setJvMapping((prev) => ({
                ...prev,
                [f.key]: next ? String(next) : undefined,
              }))
            }
            placeholder={`Search or pick ${f.label} header`}
            disabled={!editable}
          />
        </div>
      ))}
    </Space>
  )

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <PageHeader
              title="Header Mapping"
              description="Upload Sales Excel once to load columns, then configure Sales/PDF, unique columns, JV, filter date, financial year, and description mappings."
            />

            <div style={sectionCardStyle}>
              {renderSectionHeader(
                'Excel Columns',
                'Upload one Sales Excel file. Its headers are saved and used in every mapping dropdown below.',
              )}
              <Upload.Dragger
                multiple={false}
                accept=".csv,.xlsx,.xls"
                showUploadList={false}
                beforeUpload={handleSharedColumnsBeforeUpload}
                disabled={columnMappingSaving}
                style={{ padding: 16 }}
              >
                <Title level={5} style={{ margin: 0 }}>
                  Sales Excel
                </Title>
                <Text type="secondary">
                  Drop Excel here to load columns for all header mappings
                </Text>
                {columnFile ? (
                  <div style={{ marginTop: 8 }}>
                    <Text strong>{columnFile.name}</Text>
                  </div>
                ) : null}
              </Upload.Dragger>
              {columnMappingLoading ? (
                <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
                  Loading saved columns...
                </Text>
              ) : sharedColumns.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary">
                    {sharedColumns.length} columns loaded
                  </Text>
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {sharedColumns.slice(0, 20).map((col) => (
                      <Tag key={col}>{col}</Tag>
                    ))}
                    {sharedColumns.length > 20 ? (
                      <Tag>+{sharedColumns.length - 20} more</Tag>
                    ) : null}
                  </div>
                </div>
              ) : (
                <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
                  No columns stored yet. Upload an Excel file to populate mapping dropdowns.
                </Text>
              )}
            </div>

            <div style={sectionCardStyle}>
              {renderSectionHeader(
                'Sales & PDF Header Mapping',
                mode === 'update'
                  ? 'Current Sales and PDF column mapping.'
                  : 'Map required Sales/PDF headers using the uploaded Excel columns.',
                !mappingModalOpen ? (
                  <Button type="primary" onClick={() => setMappingModalOpen(true)}>
                    {mode === 'update' ? 'Update Header Mapping' : 'Create Header Mapping'}
                  </Button>
                ) : null,
              )}
              {loadingMapping ? (
                <Text type="secondary">Loading saved header mapping...</Text>
              ) : mode === 'update' && existingPreview ? (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
                    gap: 16,
                    width: '100%',
                  }}
                >
                  <div style={{ ...sectionCardStyle, background: '#fff' }}>
                    <Title level={5} style={{ margin: 0, marginBottom: 12 }}>
                      Sales Header Map
                    </Title>
                    {renderSalesMappingForm('preview', false)}
                  </div>
                  <div style={{ ...sectionCardStyle, background: '#fff' }}>
                    <Title level={5} style={{ margin: 0, marginBottom: 12 }}>
                      PDF Header Map
                    </Title>
                    {renderPdfMappingForm('preview', false)}
                  </div>
                </div>
              ) : (
                <Text type="secondary">No header mapping saved yet. Use the button on the right to create one.</Text>
              )}
            </div>

            <div style={sectionCardStyle}>
              {renderSectionHeader(
                'Sales Data Unique Column',
                'Pick one or more Sales columns that together identify a unique row.',
                !salesUniqueModalOpen ? (
                  <Button
                    type="primary"
                    onClick={async () => {
                      setSalesUniqueModalOpen(true)
                      await fetchSalesUniqueColumns()
                    }}
                  >
                    {salesUniqueMode === 'update' ? 'Update Unique Columns' : 'Setup Unique Columns'}
                  </Button>
                ) : null,
              )}
              {salesUniqueLoading ? (
                <Text type="secondary">Loading sales unique column mapping...</Text>
              ) : salesUniqueMode === 'update' && salesUniqueExistingPreview ? (
                renderSalesUniqueColumnForm(false)
              ) : (
                <Text type="secondary">
                  No unique column mapping saved yet. Use the button on the right to configure it.
                </Text>
              )}
            </div>

            <div style={sectionCardStyle}>
              {renderSectionHeader(
                'JV Process Header Mapping',
                'Map INV, Date, and Business Area from JV Excel.',
                !jvMappingModalOpen ? (
                  <Button type="primary" onClick={() => setJvMappingModalOpen(true)}>
                    {jvMode === 'update'
                      ? 'Update JV Mapping'
                      : 'Setup JV Mapping'}
                  </Button>
                ) : null,
              )}
              {jvLoadingMapping ? (
                <Text type="secondary">Loading JV process header mapping...</Text>
              ) : jvMode === 'update' && jvExistingPreview ? (
                renderJvMappingForm('preview-jv', false)
              ) : (
                <Text type="secondary">No JV mapping saved yet. Use the button on the right to set it up.</Text>
              )}
            </div>

            <div style={sectionCardStyle}>
              {renderSectionHeader(
                'Filter Date for Report',
                'Pick one Sales column used as the filter date in reports.',
                !filterDateModalOpen ? (
                  <Button
                    type="primary"
                    onClick={async () => {
                      setFilterDateModalOpen(true)
                      await fetchFilterDateMapping()
                    }}
                  >
                    {filterDateMode === 'update'
                      ? 'Update Filter Date'
                      : 'Setup Filter Date'}
                  </Button>
                ) : null,
              )}
              {filterDateLoading ? (
                <Text type="secondary">Loading filter date header mapping...</Text>
              ) : filterDateMode === 'update' && filterDateExistingPreview ? (
                renderFilterDateMappingForm('preview-filter-date', false)
              ) : (
                <Text type="secondary">
                  No filter date column saved yet. Use the button on the right to configure it.
                </Text>
              )}
            </div>

            <div style={sectionCardStyle}>
              {renderSectionHeader(
                'Financial Year Column',
                'Pick the Sales date column used to compute financial year (e.g. Billing Date → 2024-25).',
                !financialYearModalOpen ? (
                  <Button
                    type="primary"
                    onClick={async () => {
                      setFinancialYearModalOpen(true)
                      await fetchFinancialYearMapping()
                    }}
                  >
                    {financialYearMode === 'update'
                      ? 'Update Financial Year'
                      : 'Setup Financial Year'}
                  </Button>
                ) : null,
              )}
              {financialYearLoading ? (
                <Text type="secondary">Loading financial year header mapping...</Text>
              ) : financialYearMode === 'update' && financialYearExistingPreview ? (
                renderFinancialYearMappingForm('preview-financial-year', false)
              ) : (
                <Text type="secondary">
                  No financial year column saved yet. Use the button on the right to configure it.
                </Text>
              )}
            </div>

            <div style={sectionCardStyle}>
              {renderSectionHeader(
                'Manual Match Description',
                'Pick the Sales Excel description column for manual process matching (PDF uses id.4.DESCRIPTION).',
                !manualMatchDescModalOpen ? (
                  <Button
                    type="primary"
                    onClick={async () => {
                      setManualMatchDescModalOpen(true)
                      await fetchManualMatchDescriptionMapping()
                    }}
                  >
                    {manualMatchDescMode === 'update'
                      ? 'Update Description Column'
                      : 'Setup Description Column'}
                  </Button>
                ) : null,
              )}
              {manualMatchDescLoading ? (
                <Text type="secondary">Loading manual match description mapping...</Text>
              ) : manualMatchDescMode === 'update' && manualMatchDescExistingPreview ? (
                renderManualMatchDescriptionForm('preview-manual-match-desc', false)
              ) : (
                <Text type="secondary">
                  No description column saved yet. Use the button on the right to configure it.
                </Text>
              )}
            </div>

            <Modal
              open={mappingModalOpen}
              onCancel={() => setMappingModalOpen(false)}
              footer={null}
              width="95vw"
              style={{ top: 24, maxWidth: 1400 }}
              destroyOnClose
            >
              {sharedColumns.length === 0 ? (
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Upload Sales Excel above first so column dropdowns are populated.
                </Text>
              ) : null}

              <div
                style={{
                  marginTop: 0,
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 16,
                  alignItems: 'start',
                }}
              >
                <div style={{ border: '1px solid #f0f0f0', borderRadius: 12, padding: 16 }}>
                  <Title level={5} style={{ margin: 0, marginBottom: 12 }}>
                    Sales Header Map
                  </Title>
                  {renderSalesMappingForm('modal', true)}
                </div>

                <div style={{ border: '1px solid #f0f0f0', borderRadius: 12, padding: 16 }}>
                  <Title level={5} style={{ margin: 0, marginBottom: 12 }}>
                    PDF Header Map
                  </Title>
                  {renderPdfMappingForm('modal', true)}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
                <Button type="primary" onClick={handleSave} loading={saving}>
                  {mode === 'update' ? 'Update Header Mapping' : 'Create Header Mapping'}
                </Button>
              </div>
            </Modal>

            <Modal
              open={jvMappingModalOpen}
              onCancel={() => setJvMappingModalOpen(false)}
              footer={null}
              width={900}
              style={{ top: 24, maxWidth: '95vw' }}
              destroyOnClose
            >
              {sharedColumns.length === 0 ? (
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Upload Sales Excel above first so column dropdowns are populated.
                </Text>
              ) : null}

              <div style={{ border: '1px solid #f0f0f0', borderRadius: 12, padding: 16 }}>
                <Title level={5} style={{ margin: 0, marginBottom: 12 }}>
                  JV Process Header Map
                </Title>
                {renderJvMappingForm('modal-jv', true)}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
                <Button type="primary" onClick={handleSaveJv} loading={jvSaving}>
                  {jvMode === 'update'
                    ? 'Update JV Process Header Mapping'
                    : 'Setup JV Process Header Mapping'}
                </Button>
              </div>
            </Modal>

            <Modal
              open={filterDateModalOpen}
              onCancel={() => setFilterDateModalOpen(false)}
              footer={null}
              width={900}
              style={{ top: 24, maxWidth: '95vw' }}
              destroyOnClose
            >
              {sharedColumns.length === 0 ? (
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Upload Sales Excel above first so column dropdowns are populated.
                </Text>
              ) : null}

              <div style={{ border: '1px solid #f0f0f0', borderRadius: 12, padding: 16 }}>
                <Title level={5} style={{ margin: 0, marginBottom: 12 }}>
                  Filter Date for Report
                </Title>
                {renderFilterDateMappingForm('modal-filter-date', true)}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
                <Button type="primary" onClick={handleSaveFilterDate} loading={filterDateSaving}>
                  {filterDateMode === 'update'
                    ? 'Update Filter Date Mapping'
                    : 'Save Filter Date Mapping'}
                </Button>
              </div>
            </Modal>

            <Modal
              open={salesUniqueModalOpen}
              onCancel={() => setSalesUniqueModalOpen(false)}
              footer={null}
              width={900}
              style={{ top: 24, maxWidth: '95vw' }}
              destroyOnClose
            >
              {sharedColumns.length === 0 ? (
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Upload Sales Excel above first so column dropdowns are populated.
                </Text>
              ) : null}

              <div style={{ border: '1px solid #f0f0f0', borderRadius: 12, padding: 16 }}>
                <Title level={5} style={{ margin: 0, marginBottom: 12 }}>
                  Sales Data Unique Column
                </Title>
                {renderSalesUniqueColumnForm(true)}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
                <Button type="primary" onClick={handleSaveSalesUniqueColumns} loading={salesUniqueSaving}>
                  {salesUniqueMode === 'update'
                    ? 'Update Unique Column Mapping'
                    : 'Save Unique Column Mapping'}
                </Button>
              </div>
            </Modal>

            <Modal
              open={financialYearModalOpen}
              onCancel={() => setFinancialYearModalOpen(false)}
              footer={null}
              width={900}
              style={{ top: 24, maxWidth: '95vw' }}
              destroyOnClose
            >
              {sharedColumns.length === 0 ? (
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Upload Sales Excel above first so column dropdowns are populated.
                </Text>
              ) : null}

              <div style={{ border: '1px solid #f0f0f0', borderRadius: 12, padding: 16 }}>
                <Title level={5} style={{ margin: 0, marginBottom: 12 }}>
                  Financial Year Column
                </Title>
                {renderFinancialYearMappingForm('modal-financial-year', true)}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
                <Button type="primary" onClick={handleSaveFinancialYear} loading={financialYearSaving}>
                  {financialYearMode === 'update'
                    ? 'Update Financial Year Mapping'
                    : 'Save Financial Year Mapping'}
                </Button>
              </div>
            </Modal>

            <Modal
              open={manualMatchDescModalOpen}
              onCancel={() => setManualMatchDescModalOpen(false)}
              footer={null}
              width={900}
              style={{ top: 24, maxWidth: '95vw' }}
              destroyOnClose
            >
              {sharedColumns.length === 0 ? (
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Upload Sales Excel above first so column dropdowns are populated.
                </Text>
              ) : null}

              <div style={{ border: '1px solid #f0f0f0', borderRadius: 12, padding: 16 }}>
                <Title level={5} style={{ margin: 0, marginBottom: 12 }}>
                  Description Column
                </Title>
                {renderManualMatchDescriptionForm('modal-manual-match-desc', true)}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
                <Button
                  type="primary"
                  onClick={handleSaveManualMatchDescription}
                  loading={manualMatchDescSaving}
                >
                  {manualMatchDescMode === 'update'
                    ? 'Update Description Mapping'
                    : 'Save Description Mapping'}
                </Button>
              </div>
            </Modal>
          </Space>
        </AppShell>
  )
}
