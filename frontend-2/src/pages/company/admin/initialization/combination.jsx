import { Button, Layout, Modal, Select, Space, Table, Tag, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography

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
    const fetchCombinations = async () => {
      if (!BACKEND_URL) return
      setLoading(true)
      try {
        // NOTE: endpoint name not provided by you. Adjust if backend differs.
        const res = await fetch(`${BACKEND_URL}/api/company/admin/combination/`, {
          method: 'GET',
          credentials: 'include',
        })

        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          // keep blank UI if 404 / not found
          setCombinations([])
          return
        }

        const list =
          data?.data ||
          data?.combinations ||
          data?.results ||
          data?.combination ||
          data ||
          []

        if (!mounted) return
        setCombinations(Array.isArray(list) ? list : list ? [list] : [])
      } catch {
        if (!mounted) return
        setCombinations([])
      } finally {
        if (mounted) setLoading(false)
      }
    }

    fetchCombinations()
    return () => {
      mounted = false
    }
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
      setOpen(false)
      resetDraft()

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
      setCombinations(Array.isArray(list) ? list : list ? [list] : [])
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
    render: (_, record) => (
      <Select
        allowClear
        style={{ width: '100%' }}
        value={record.slots[index] ?? undefined}
        options={salesSelectOptions}
        placeholder="Select"
        onChange={(value) => updateDraftRow('sales', record.id, index, value)}
      />
    ),
  }))

  salesTableColumns.push(
    {
      title: 'Combination',
      key: 'sales-combination',
      render: (_, record) => <Text code>{formatComboForDisplay(buildComboString(record.slots)) || '-'}</Text>,
    },
    {
      title: 'X',
      key: 'sales-action',
      width: 64,
      render: (_, record) => (
        <Button type="text" danger onClick={() => removeDraftRow('sales', record.id)}>
          X
        </Button>
      ),
    },
  )

  const pdfTableColumns = Array.from({ length: pdfKeysResolved.length }, (_, index) => ({
    title: `Part ${index + 1}`,
    key: `pdf-part-${index}`,
    render: (_, record) => (
      <Select
        allowClear
        style={{ width: '100%' }}
        value={record.slots[index] ?? undefined}
        options={pdfSelectOptions}
        placeholder="Select"
        onChange={(value) => updateDraftRow('pdf', record.id, index, value)}
      />
    ),
  }))

  pdfTableColumns.push(
    {
      title: 'Combination',
      key: 'pdf-combination',
      render: (_, record) => <Text code>{formatComboForDisplay(buildComboString(record.slots)) || '-'}</Text>,
    },
    {
      title: 'X',
      key: 'pdf-action',
      width: 64,
      render: (_, record) => (
        <Button type="text" danger onClick={() => removeDraftRow('pdf', record.id)}>
          X
        </Button>
      ),
    },
  )

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                Combinations
              </Title>
              <Text type="secondary">Sales combinations on the left, PDF combinations on the right.</Text>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <Button
                type="primary"
                onClick={async () => {
                  setOpen(true)
                  const extracted = await fetchHeaderMapping()
                  const sk = extracted?.salesKeys?.length
                    ? extracted.salesKeys
                    : headerMapping?.salesKeys?.length
                      ? headerMapping.salesKeys
                      : DEFAULT_SALES_KEYS
                  const pk = extracted?.pdfKeys?.length
                    ? extracted.pdfKeys
                    : headerMapping?.pdfKeys?.length
                      ? headerMapping.pdfKeys
                      : DEFAULT_PDF_KEYS

                  const salesSaved = extractSavedCombinationRows(combinations, 'sales')
                  const pdfSaved = extractSavedCombinationRows(combinations, 'pdf')
                  const hasSaved = salesSaved.length > 0 || pdfSaved.length > 0

                  if (hasSaved) {
                    setSalesDraftRows(
                      salesSaved.length
                        ? savedTableRowsToDraftRows(salesSaved, sk)
                        : [createDraftRow(sk.length)],
                    )
                    setPdfDraftRows(
                      pdfSaved.length
                        ? savedTableRowsToDraftRows(pdfSaved, pk)
                        : [createDraftRow(pk.length)],
                    )
                  } else {
                    initializeDraftTables(extracted)
                  }
                }}
              >
                {hasExistingCombinations ? 'Modify combination' : 'Setup Combination'}
              </Button>
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 20,
                alignItems: 'start',
              }}
            >
              <div
                style={{
                  flex: '1 1 360px',
                  border: '1px solid #f0f0f0',
                  borderRadius: 16,
                  padding: 20,
                  background: 'linear-gradient(180deg, #ffffff 0%, #fafafa 100%)',
                  boxShadow: '0 10px 30px rgba(15, 23, 42, 0.04)',
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <Text strong style={{ display: 'block' }}>
                      Sales Combinations
                    </Text>
                    <Text type="secondary">Available sales-side mappings.</Text>
                  </div>
                  <Tag color="blue">{salesCombinationRows.length}</Tag>
                </div>

                <Table
                  size="small"
                  loading={loading}
                  pagination={false}
                  columns={salesSavedColumns}
                  dataSource={salesCombinationRows}
                  locale={{ emptyText: 'No sales combinations yet' }}
                  scroll={{ x: 420 }}
                />
              </div>

              <div
                style={{
                  flex: '1 1 360px',
                  border: '1px solid #f0f0f0',
                  borderRadius: 16,
                  padding: 20,
                  background: 'linear-gradient(180deg, #ffffff 0%, #fafafa 100%)',
                  boxShadow: '0 10px 30px rgba(15, 23, 42, 0.04)',
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <Text strong style={{ display: 'block' }}>
                      PDF Combinations
                    </Text>
                    <Text type="secondary">Available PDF-side mappings.</Text>
                  </div>
                  <Tag color="green">{pdfCombinationRows.length}</Tag>
                </div>

                <Table
                  size="small"
                  loading={loading}
                  pagination={false}
                  columns={pdfSavedColumns}
                  dataSource={pdfCombinationRows}
                  locale={{ emptyText: 'No PDF combinations yet' }}
                  scroll={{ x: 420 }}
                />
              </div>
            </div>
          </Space>
        

      <Modal
        open={open}
        onCancel={() => { setOpen(false); resetDraft() }}
        footer={null}
        width="95vw"
        style={{ top: 24, maxWidth: 1400 }}
        bodyStyle={{ height: '80vh', overflow: 'auto' }}
        destroyOnClose
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Title level={4} style={{ margin: 0 }}>
            {hasExistingCombinations ? 'Modify Header Combinations' : 'Setup Header Combinations'}
          </Title>
          <Text type="secondary">
            {hasExistingCombinations
              ? 'Update Sales and PDF rows below, then save.'
              : 'Build Sales rows on the left and PDF rows on the right, then save both sets together.'}
          </Text>

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
            {loadingMapping ? <Text type="secondary">Loading header mapping...</Text> : null}
          </div>

          <div
            style={{
              marginTop: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              alignItems: 'start',
              width: '100%',
            }}
          >
            <div
              style={{
                minWidth: 0,
                border: '1px solid #f0f0f0',
                borderRadius: 12,
                padding: 16,
                background: '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div>
                  <Text strong style={{ display: 'block' }}>
                    Sales Combination
                  </Text>
                  <Text type="secondary">Left-side sales builder</Text>
                </div>
                <Button onClick={addSalesDraftRow}>+ Add Row</Button>
              </div>
              <Table
                size="small"
                pagination={false}
                columns={salesTableColumns}
                dataSource={salesDraftRows.map((row) => ({ ...row, key: row.id }))}
                locale={{ emptyText: 'No sales rows' }}
                scroll={{ x: Math.max(760, salesKeysResolved.length * 130) }}
              />
            </div>

            <div
              style={{
                minWidth: 0,
                border: '1px solid #f0f0f0',
                borderRadius: 12,
                padding: 16,
                background: '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div>
                  <Text strong style={{ display: 'block' }}>
                    PDF Combination
                  </Text>
                  <Text type="secondary">Right-side PDF builder</Text>
                </div>
                <Button onClick={addPdfDraftRow}>+ Add Row</Button>
              </div>
              <Table
                size="small"
                pagination={false}
                columns={pdfTableColumns}
                dataSource={pdfDraftRows.map((row) => ({ ...row, key: row.id }))}
                locale={{ emptyText: 'No PDF rows' }}
                scroll={{ x: Math.max(640, pdfKeysResolved.length * 130) }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <Button onClick={resetDraft}>Clear</Button>
            <Button onClick={() => { setOpen(false); resetDraft() }}>Cancel</Button>
            <Button type="primary" loading={saving} onClick={handleCreateCombination}>
              {hasExistingCombinations ? 'Save changes' : 'Create combination'}
            </Button>
          </div>
        </Space>
      </Modal>
    </AppShell>
  )
}
