import { Button, Layout, Select, Space, Table, Tag, Typography, message, Popconfirm } from 'antd'
import { useEffect, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'
import { AccessControl } from '../../../../components/iam/AccessControl.jsx'

const { Content } = Layout
const { Title, Text } = Typography

const sectionCardStyle = {
  background: '#fff',
  padding: '24px',
  borderRadius: '8px',
  borderTop: '4px solid #1677ff',
  boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)',
  border: '1px solid var(--exim-border-light, #e2e8f0)',
}

/** Fallback part keys if API returns nothing yet */
const DEFAULT_SALES_KEYS = ['inv', 'qty1', 'qty2', 'amount']
const DEFAULT_PDF_KEYS = ['inv', 'qty', 'amount']

/** API uses lowercase keys (inv, ayush, …); combo tokens use uppercase (INV, AYUSH, …). */
function keyToToken(key) {
  return String(key || '').trim().toUpperCase()
}

function buildComboString(tokens) {
  // Backend should receive pipe-separated tokens (user request).
  return (tokens || []).filter(Boolean).join(' | ')
}

// UI-only formatting: backend stores "_" separators, but user wants " | ".
function formatComboForDisplay(comboString) {
  return (comboString || '').split('_').filter(Boolean).join(' | ')
}

function normalizeCombinationValue(item) {
  if (typeof item === 'string') return item.trim()
  if (!item || typeof item !== 'object') return ''

  return String(item.value || item.combination || item.name || item.invQtyAmount || '').trim()
}

function toCombinationValueArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeCombinationValue(item)).filter(Boolean)
  }

  const normalized = normalizeCombinationValue(value)
  return normalized ? [normalized] : []
}

function getSideCombinationValues(item, side) {
  const direct =
    side === 'sales'
      ? item?.salesCombination ?? item?.combination?.salesCombination
      : item?.pdfCombination ?? item?.combination?.pdfCombination
  const nested =
    side === 'sales'
      ? item?.sales?.combination || item?.sales?.name || item?.sales?.invQtyAmount
      : item?.pdf?.combination || item?.pdf?.name || item?.pdf?.invQtyAmount

  if (Array.isArray(direct)) return toCombinationValueArray(direct)
  if (direct) return toCombinationValueArray(direct)
  return toCombinationValueArray(nested)
}

function extractSavedCombinationRows(input, side) {
  const list = Array.isArray(input) ? input : input ? [input] : []
  const rows = []
  const seen = new Set()

  const walk = (item, fallbackId = 'row') => {
    if (!item || typeof item !== 'object') return

    getSideCombinationValues(item, side).forEach((value) => {
      const formatted = formatComboForDisplay(value)
      if (!formatted || seen.has(formatted)) return

      seen.add(formatted)
      rows.push({
        key: `${side}-${fallbackId}-${rows.length}`,
        combination: formatted,
      })
    })

    if (Array.isArray(item?.combinations)) {
      item.combinations.forEach((child, index) => {
        walk(child, `${fallbackId}-${index}`)
      })
    }
  }

  list.forEach((item, index) => walk(item, `row-${index}`))

  return rows.map((item, index) => ({
    ...item,
    index: index + 1,
  }))
}

function createDraftRow(slotCount) {
  return {
    id: `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    slots: Array.from({ length: slotCount }, () => ''),
  }
}

/** Rebuild per-column slots from a display combo like "INV | QTY1 | AMOUNT" (order follows columns). */
function slotsFromComboDisplay(comboDisplay, keys) {
  const parts = String(comboDisplay || '')
    .split(/\s*\|\s*/)
    .map((t) => t.trim())
    .filter(Boolean)
  const slots = keys.map(() => '')
  const used = new Set()
  for (const tok of parts) {
    const upper = keyToToken(tok)
    const col = keys.findIndex((k, i) => !used.has(i) && keyToToken(k) === upper)
    if (col >= 0) {
      slots[col] = upper
      used.add(col)
    }
  }
  return slots
}

function savedTableRowsToDraftRows(savedRows, keys) {
  const n = keys?.length ? keys.length : 0
  if (!savedRows?.length) return [createDraftRow(n)]
  return savedRows.map((row, idx) => ({
    id: `draft-loaded-${idx}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    slots: slotsFromComboDisplay(row.combination, keys),
  }))
}

function buildSalesPayload(slots, salesKeys) {
  const keys = salesKeys?.length ? salesKeys : DEFAULT_SALES_KEYS
  const sales = {}
  for (const key of keys) {
    const tok = keyToToken(key)
    sales[key] = slots.includes(tok) ? tok : ''
  }
  return {
    salesCombination: buildComboString(slots),
    sales,
  }
}

function buildPdfPayload(slots, pdfKeys) {
  const keys = pdfKeys?.length ? pdfKeys : DEFAULT_PDF_KEYS
  const pdf = {}
  for (const key of keys) {
    const tok = keyToToken(key)
    pdf[key] = slots.includes(tok) ? tok : ''
  }
  return {
    pdfCombination: buildComboString(slots),
    pdf,
  }
}

export default function CompanyAdminCombinationPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [loading, setLoading] = useState(false)
  const [combinations, setCombinations] = useState([])
  const [isEditing, setIsEditing] = useState(false)

  // modal state
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [salesDraftRows, setSalesDraftRows] = useState([])
  const [pdfDraftRows, setPdfDraftRows] = useState([])

  // header mapping values for dropdown labels
  const [headerMapping, setHeaderMapping] = useState(null)
  const [loadingMapping, setLoadingMapping] = useState(false)

  useEffect(() => {
    let mounted = true
    const loadData = async () => {
      if (!BACKEND_URL) return
      setLoading(true)
      
      let mappingResult = null
      try {
        const mapRes = await fetch(`${BACKEND_URL}/api/company/admin/header-mapping/`, { method: 'GET', credentials: 'include' })
        const mapData = await mapRes.json().catch(() => ({}))
        if (mapRes.ok) mappingResult = extractHeaderMapping(mapData)
      } catch {}
      
      if (mounted && mappingResult) setHeaderMapping(mappingResult)

      let comboResult = []
      try {
        const comboRes = await fetch(`${BACKEND_URL}/api/company/admin/combination/`, { method: 'GET', credentials: 'include' })
        const comboData = await comboRes.json().catch(() => ({}))
        if (comboRes.ok) {
          comboResult = comboData?.data || comboData?.combinations || comboData?.results || comboData?.combination || comboData || []
          comboResult = Array.isArray(comboResult) ? comboResult : comboResult ? [comboResult] : []
        }
      } catch {}
      
      if (mounted) {
        setCombinations(comboResult)
        const sk = mappingResult?.salesKeys?.length ? mappingResult.salesKeys : DEFAULT_SALES_KEYS
        const pk = mappingResult?.pdfKeys?.length ? mappingResult.pdfKeys : DEFAULT_PDF_KEYS
        const salesSaved = extractSavedCombinationRows(comboResult, 'sales')
        const pdfSaved = extractSavedCombinationRows(comboResult, 'pdf')
        const hasSaved = salesSaved.length > 0 || pdfSaved.length > 0

        if (hasSaved) {
          setSalesDraftRows(salesSaved.length ? savedTableRowsToDraftRows(salesSaved, sk) : [createDraftRow(sk.length)])
          setPdfDraftRows(pdfSaved.length ? savedTableRowsToDraftRows(pdfSaved, pk) : [createDraftRow(pk.length)])
        } else {
          setSalesDraftRows([createDraftRow(sk.length)])
          setPdfDraftRows([createDraftRow(pk.length)])
        }
        setLoading(false)
      }
    }

    loadData()
    return () => { mounted = false }
  }, [BACKEND_URL])

  const extractHeaderMapping = (raw) => {
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

    const salesKeys =
      sales && typeof sales === 'object' && !Array.isArray(sales) ? Object.keys(sales) : []
    const pdfKeys =
      pdf && typeof pdf === 'object' && !Array.isArray(pdf) ? Object.keys(pdf) : []

    const salesInv = sales?.inv ?? sales?.invoice ?? sales?.invoiceNumber ?? sales?.invHeader
    const salesQty1 = sales?.qty1 ?? sales?.qty_1 ?? sales?.quantity1
    const salesQty2 = sales?.qty2 ?? sales?.qty_2 ?? sales?.quantity2
    const salesAmount = sales?.amount ?? sales?.totalAmount ?? sales?.amt

    const pdfInv = pdf?.inv ?? pdf?.invoice ?? pdf?.invoiceNumber ?? pdf?.invHeader
    const pdfQty = pdf?.qty ?? pdf?.quantity ?? pdf?.qty1 ?? pdf?.qty_1
    const pdfAmount = pdf?.amount ?? pdf?.totalAmount ?? pdf?.amt

    const hasSomething =
      salesKeys.length > 0 ||
      pdfKeys.length > 0 ||
      salesInv ||
      salesQty1 ||
      salesQty2 ||
      salesAmount ||
      pdfInv ||
      pdfQty ||
      pdfAmount

    if (!hasSomething) return null

    const salesOut =
      salesKeys.length && sales && typeof sales === 'object'
        ? { ...sales }
        : { inv: salesInv ?? '', qty1: salesQty1 ?? '', qty2: salesQty2 ?? '', amount: salesAmount ?? '' }

    const pdfOut =
      pdfKeys.length && pdf && typeof pdf === 'object'
        ? { ...pdf }
        : { inv: pdfInv ?? '', qty: pdfQty ?? '', amount: pdfAmount ?? '' }

    return {
      id,
      sales: salesOut,
      pdf: pdfOut,
      salesKeys: salesKeys.length ? salesKeys : DEFAULT_SALES_KEYS,
      pdfKeys: pdfKeys.length ? pdfKeys : DEFAULT_PDF_KEYS,
    }
  }

  const fetchHeaderMapping = async () => {
    if (!BACKEND_URL) return null
    if (loadingMapping) return null

    setLoadingMapping(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/header-mapping/`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return null
      const extracted = extractHeaderMapping(data)
      if (extracted) setHeaderMapping(extracted)
      return extracted
    } catch {
      return null
    } finally {
      setLoadingMapping(false)
    }
  }

  const addSalesDraftRow = () => {
    const n = headerMapping?.salesKeys?.length ?? DEFAULT_SALES_KEYS.length
    setSalesDraftRows((prev) => [...prev, createDraftRow(n)])
  }

  const addPdfDraftRow = () => {
    const n = headerMapping?.pdfKeys?.length ?? DEFAULT_PDF_KEYS.length
    setPdfDraftRows((prev) => [...prev, createDraftRow(n)])
  }

  const restoreDrafts = (comboList) => {
    const listToUse = comboList || combinations
    const sk = headerMapping?.salesKeys?.length ? headerMapping.salesKeys : DEFAULT_SALES_KEYS
    const pk = headerMapping?.pdfKeys?.length ? headerMapping.pdfKeys : DEFAULT_PDF_KEYS
    const salesSaved = extractSavedCombinationRows(listToUse, 'sales')
    const pdfSaved = extractSavedCombinationRows(listToUse, 'pdf')
    const hasSaved = salesSaved.length > 0 || pdfSaved.length > 0

    if (hasSaved) {
      setSalesDraftRows(salesSaved.length ? savedTableRowsToDraftRows(salesSaved, sk) : [createDraftRow(sk.length)])
      setPdfDraftRows(pdfSaved.length ? savedTableRowsToDraftRows(pdfSaved, pk) : [createDraftRow(pk.length)])
    } else {
      setSalesDraftRows([createDraftRow(sk.length)])
      setPdfDraftRows([createDraftRow(pk.length)])
    }
  }

  const resetDraft = () => {
    setSalesDraftRows([])
    setPdfDraftRows([])
  }

  const initializeDraftTables = (mapping = null) => {
    const sk = mapping?.salesKeys?.length ? mapping.salesKeys : headerMapping?.salesKeys?.length ? headerMapping.salesKeys : DEFAULT_SALES_KEYS
    const pk = mapping?.pdfKeys?.length ? mapping.pdfKeys : headerMapping?.pdfKeys?.length ? headerMapping.pdfKeys : DEFAULT_PDF_KEYS
    setSalesDraftRows([createDraftRow(sk.length)])
    setPdfDraftRows([createDraftRow(pk.length)])
  }

  const updateDraftRow = (side, rowId, slotIndex, value) => {
    const setRows = side === 'sales' ? setSalesDraftRows : setPdfDraftRows
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row
        const slots = [...row.slots]
        slots[slotIndex] = value || ''
        return { ...row, slots }
      }),
    )
  }

  const removeDraftRow = (side, rowId) => {
    const setRows = side === 'sales' ? setSalesDraftRows : setPdfDraftRows
    setRows((prev) => prev.filter((row) => row.id !== rowId))
  }

  const salesKeysResolved = headerMapping?.salesKeys?.length
    ? headerMapping.salesKeys
    : DEFAULT_SALES_KEYS
  const pdfKeysResolved = headerMapping?.pdfKeys?.length
    ? headerMapping.pdfKeys
    : DEFAULT_PDF_KEYS

  const salesDraftPayloads = salesDraftRows
    .map((row) => ({
      id: row.id,
      slots: row.slots,
      ...buildSalesPayload(row.slots, salesKeysResolved),
    }))
    .filter((row) => row.salesCombination)

  const pdfDraftPayloads = pdfDraftRows
    .map((row) => ({
      id: row.id,
      slots: row.slots,
      ...buildPdfPayload(row.slots, pdfKeysResolved),
    }))
    .filter((row) => row.pdfCombination)

  const salesCombinationEntries = Array.from(
    new Map(salesDraftPayloads.map((row) => [row.salesCombination, row])).values(),
  )

  const pdfCombinationEntries = Array.from(
    new Map(pdfDraftPayloads.map((row) => [row.pdfCombination, row])).values(),
  )

  const handleCreateCombination = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }

    if (!salesCombinationEntries.length) {
      message.error('Please create at least 1 Sales combination first.')
      return
    }

    if (!pdfCombinationEntries.length) {
      message.error('Please create at least 1 PDF combination first.')
      return
    }

    const salesCombinationList = salesCombinationEntries.map((x) => x.salesCombination)
    const pdfCombinationList = pdfCombinationEntries.map((x) => x.pdfCombination)

    setSaving(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/combination/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ salesCombination: salesCombinationList, pdfCombination: pdfCombinationList }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || 'Failed to save combinations')
      }

      message.success('Combinations saved successfully')

      // refresh list
      setLoading(true)
      const refetch = await fetch(`${BACKEND_URL}/api/company/admin/combination/`, {
        method: 'GET',
        credentials: 'include',
      })
      const refetchData = await refetch.json().catch(() => ({}))
      const list =
        refetchData?.data ||
        refetchData?.combinations ||
        refetchData?.results ||
        refetchData ||
        []
      const parsedList = Array.isArray(list) ? list : list ? [list] : []
      setCombinations(parsedList)
      restoreDrafts(parsedList)
      setIsEditing(false)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save combinations')
    } finally {
      setSaving(false)
      setLoading(false)
    }
  }

  const salesCombinationRows = extractSavedCombinationRows(combinations, 'sales')
  const pdfCombinationRows = extractSavedCombinationRows(combinations, 'pdf')
  const hasExistingCombinations =
    salesCombinationRows.length > 0 || pdfCombinationRows.length > 0

  const buildSavedColumns = (label, color) => [
    {
      title: '#',
      dataIndex: 'index',
      key: 'index',
      width: 64,
    },
    {
      title: `${label} Combination`,
      dataIndex: 'combination',
      key: 'combination',
      render: (value) => (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
          <Tag color={color} style={{ marginInlineEnd: 0 }}>
            {label}
          </Tag>
          <Text code style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
            {value || '-'}
          </Text>
        </div>
      ),
    },
  ]

  const salesSavedColumns = buildSavedColumns('Sales', 'blue')
  const pdfSavedColumns = buildSavedColumns('PDF', 'green')

  const salesSelectOptions = [
    { label: 'Blank', value: '' },
    ...salesKeysResolved.map((key) => {
      const tok = keyToToken(key)
      return { label: tok, value: tok }
    }),
  ]
  const pdfSelectOptions = [
    { label: 'Blank', value: '' },
    ...pdfKeysResolved.map((key) => {
      const tok = keyToToken(key)
      return { label: tok, value: tok }
    }),
  ]
  const salesTableColumns = Array.from({ length: salesKeysResolved.length }, (_, index) => ({
    title: `Part ${index + 1}`,
    key: `sales-part-${index}`,
    render: (_, record) => isEditing ? (
      <Select
        allowClear
        style={{ width: '100%' }}
        value={record.slots[index] ?? undefined}
        options={salesSelectOptions}
        placeholder="Select"
        onChange={(value) => updateDraftRow('sales', record.id, index, value)}
      />
    ) : (
      <Text>{record.slots[index] || <span style={{ color: '#d9d9d9' }}>Blank</span>}</Text>
    ),
  }))

  salesTableColumns.push({
    title: 'Combination',
    key: 'sales-combination',
    render: (_, record) => <Text code>{formatComboForDisplay(buildComboString(record.slots)) || '-'}</Text>,
  })

  if (isEditing) {
    salesTableColumns.push({
      title: 'X',
      key: 'sales-action',
      width: 64,
      render: (_, record) => (
        <Button type="text" danger onClick={() => removeDraftRow('sales', record.id)}>
          X
        </Button>
      ),
    })
  }

  const pdfTableColumns = Array.from({ length: pdfKeysResolved.length }, (_, index) => ({
    title: `Part ${index + 1}`,
    key: `pdf-part-${index}`,
    render: (_, record) => isEditing ? (
      <Select
        allowClear
        style={{ width: '100%' }}
        value={record.slots[index] ?? undefined}
        options={pdfSelectOptions}
        placeholder="Select"
        onChange={(value) => updateDraftRow('pdf', record.id, index, value)}
      />
    ) : (
      <Text>{record.slots[index] || <span style={{ color: '#d9d9d9' }}>Blank</span>}</Text>
    ),
  }))

  pdfTableColumns.push({
    title: 'Combination',
    key: 'pdf-combination',
    render: (_, record) => <Text code>{formatComboForDisplay(buildComboString(record.slots)) || '-'}</Text>,
  })

  if (isEditing) {
    pdfTableColumns.push({
      title: 'X',
      key: 'pdf-action',
      width: 64,
      render: (_, record) => (
        <Button type="text" danger onClick={() => removeDraftRow('pdf', record.id)}>
          X
        </Button>
      ),
    })
  }

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <PageHeader
        title="Header Combinations"
        description="Build Sales combinations on the left and PDF combinations on the right, then save both sets together."
        actions={
          <AccessControl required="initialization:combination:update">
          <Space wrap>
            {isEditing ? (
              <>
                <Button onClick={resetDraft}>Clear</Button>
                <Button onClick={() => { setIsEditing(false); restoreDrafts(); }}>Cancel</Button>
                <Button type="primary" loading={saving} onClick={handleCreateCombination}>Save Changes</Button>
              </>
            ) : (
              <Button type="primary" onClick={() => setIsEditing(true)}>Modify combination</Button>
            )}
          </Space>
          </AccessControl>
        }
      />

      <Space direction="vertical" size="large" style={{ width: '100%', marginTop: 24 }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          
          <div style={{ ...sectionCardStyle, flex: '1 1 45%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <Space align="center" style={{ marginBottom: 4 }}>
                  <Title level={5} style={{ margin: 0, color: 'var(--exim-gray-800)' }}>Sales Combinations</Title>
                  <Tag color="blue" style={{ margin: 0, border: 'none', background: '#e6f4ff', color: '#1677ff' }}>{salesCombinationRows.length}</Tag>
                </Space>
                <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>Available sales-side mappings.</Text>
              </div>
              {isEditing && <Button onClick={addSalesDraftRow}>+ Add Row</Button>}
            </div>
            {isEditing ? (
              <Table
                size="small"
                pagination={false}
                columns={salesTableColumns}
                dataSource={salesDraftRows.map((row) => ({ ...row, key: row.id }))}
                locale={{ emptyText: 'No sales rows' }}
                scroll={{ x: Math.max(760, salesKeysResolved.length * 130) }}
              />
            ) : (
              <Table
                size="small"
                pagination={false}
                columns={salesSavedColumns}
                dataSource={salesCombinationRows}
                locale={{ emptyText: 'No sales combinations yet' }}
                scroll={{ x: 420 }}
              />
            )}
          </div>

          <div style={{ ...sectionCardStyle, flex: '1 1 45%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <Space align="center" style={{ marginBottom: 4 }}>
                  <Title level={5} style={{ margin: 0, color: 'var(--exim-gray-800)' }}>PDF Combinations</Title>
                  <Tag color="green" style={{ margin: 0, border: 'none', background: '#f6ffed', color: '#52c41a' }}>{pdfCombinationRows.length}</Tag>
                </Space>
                <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>Available PDF-side mappings.</Text>
              </div>
              {isEditing && <Button onClick={addPdfDraftRow}>+ Add Row</Button>}
            </div>
            {isEditing ? (
              <Table
                size="small"
                pagination={false}
                columns={pdfTableColumns}
                dataSource={pdfDraftRows.map((row) => ({ ...row, key: row.id }))}
                locale={{ emptyText: 'No PDF rows' }}
                scroll={{ x: Math.max(640, pdfKeysResolved.length * 130) }}
              />
            ) : (
              <Table
                size="small"
                pagination={false}
                columns={pdfSavedColumns}
                dataSource={pdfCombinationRows}
                locale={{ emptyText: 'No PDF combinations yet' }}
                scroll={{ x: 420 }}
              />
            )}
          </div>

        </div>
      </Space>
    </AppShell>
  )
}
