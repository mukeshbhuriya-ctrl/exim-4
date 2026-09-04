import { WarningOutlined } from '@ant-design/icons'
import { Alert, Button, Checkbox, Layout, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'
import { AccessControl } from '../../../../components/iam/AccessControl.jsx'

const { Content } = Layout
const { Title, Text } = Typography

const sectionCardStyle = {
  background: '#ffffff',
  borderRadius: 8,
  padding: 24,
  boxShadow: '0 1px 2px rgba(0,0,0,0.03), 0 1px 6px -1px rgba(0,0,0,0.02), 0 2px 4px rgba(0,0,0,0.02)',
  borderTop: '4px solid #1677ff',
}

function formatComboForDisplay(comboString) {
  return (comboString || '').split('_').filter(Boolean).join(' | ')
}

function createConnectionRow(initial = {}) {
  return {
    id: initial.id || `connection-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    // store the actual combination string (API no longer provides IDs)
    salesId: initial.salesId || '',
    pdfId: initial.pdfId || '',
    matchDuplicate: Boolean(initial.matchDuplicate),
  }
}

function normalizeCombinationEntry(item) {
  if (typeof item === 'string') {
    const value = item.trim()
    return value ? { id: value, value } : null
  }

  if (!item || typeof item !== 'object') return null

  const value = String(item.value || item.combination || item.name || item.invQtyAmount || '').trim()
  const rawId = item.id || item._id || item.combinationId || item.mappingId || item.mapping_id || ''

  if (!value && !rawId) return null

  return {
    // Prefer using the combination text as the identifier (backend may not return ids).
    id: String(value || rawId),
    value,
  }
}

function addCombinationEntry(map, item) {
  const entry = normalizeCombinationEntry(item)
  if (!entry?.id || !entry.value) return
  if (!map.has(entry.id)) map.set(entry.id, entry)
}

function normalizeConnectionId(value) {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()

  if (typeof value === 'object') {
    return String(value.id || value._id || value.combinationId || value.value || '').trim()
  }

  return ''
}

function extractConnectionPairs(input) {
  if (!Array.isArray(input)) return []

  return input
    .map((item, index) => {
      const salesId = normalizeConnectionId(
        item?.salesId || item?.sales || item?.salesCombinationId || item?.salesCombination,
      )
      const pdfId = normalizeConnectionId(
        item?.pdfId || item?.pdf || item?.pdfCombinationId || item?.pdfCombination,
      )

      if (!salesId || !pdfId) return null

      return {
        id: item?.id || item?._id || `${salesId}__${pdfId}__${index}`,
        salesId,
        pdfId,
        matchDuplicate: Boolean(item?.matchDuplicate),
      }
    })
    .filter(Boolean)
}

function extractCombinationState(input) {
  const roots = Array.isArray(input) ? input : input ? [input] : []
  const salesMap = new Map()
  const pdfMap = new Map()
  const connectionMap = new Map()
  let companyId = null

  const walk = (item) => {
    if (!item || typeof item !== 'object') return

    if (!companyId) {
      companyId = item.companyId || item.company?.id || null
    }

    if (Array.isArray(item.salesCombination)) {
      item.salesCombination.forEach((entry) => addCombinationEntry(salesMap, entry))
    }

    if (Array.isArray(item.pdfCombination)) {
      item.pdfCombination.forEach((entry) => addCombinationEntry(pdfMap, entry))
    }

    const directSalesId = normalizeConnectionId(
      item?.salesId || item?.sales || item?.salesCombinationId || item?.salesCombination,
    )
    const directPdfId = normalizeConnectionId(
      item?.pdfId || item?.pdf || item?.pdfCombinationId || item?.pdfCombination,
    )

    if (directSalesId && directPdfId) {
      const key = `${directSalesId}__${directPdfId}`
      if (!connectionMap.has(key)) {
        connectionMap.set(key, {
          id: item?.id || item?._id || key,
          salesId: directSalesId,
          pdfId: directPdfId,
          matchDuplicate: Boolean(item?.matchDuplicate),
        })
      }
    }

    const connectionLists = [
      ...(Array.isArray(item.connections) ? [item.connections] : []),
      ...(Array.isArray(item.connectins) ? [item.connectins] : []),
      ...(Array.isArray(item.connection) ? [item.connection] : []),
      // New API shape: { connection: { connections: [...] } }
      ...(Array.isArray(item.connection?.connections) ? [item.connection.connections] : []),
    ]

    connectionLists.forEach((list) => {
      extractConnectionPairs(list).forEach((row) => {
        const key = `${row.salesId}__${row.pdfId}`
        if (!connectionMap.has(key)) connectionMap.set(key, row)
      })
    })

    if (Array.isArray(item.combinations)) {
      item.combinations.forEach((child) => walk(child))
    }
  }

  roots.forEach((item) => walk(item))

  return {
    companyId,
    salesCombinationEntries: Array.from(salesMap.values()),
    pdfCombinationEntries: Array.from(pdfMap.values()),
    existingConnections: Array.from(connectionMap.values()),
  }
}

export default function CompanyAdminConnectCombinationPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')
  const navigate = useNavigate()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [companyId, setCompanyId] = useState(null)
  const [salesCombinationEntries, setSalesCombinationEntries] = useState([])
  const [pdfCombinationEntries, setPdfCombinationEntries] = useState([])
  const [existingConnections, setExistingConnections] = useState([])
  const [connectionDraftRows, setConnectionDraftRows] = useState(() => [createConnectionRow()])

  const restoreDrafts = () => {
    setConnectionDraftRows(
      existingConnections.length
        ? existingConnections.map((row) =>
            createConnectionRow({
              id: row.id,
              salesId: row.salesId,
              pdfId: row.pdfId,
              matchDuplicate: row.matchDuplicate,
            }),
          )
        : [createConnectionRow()],
    )
  }

  const resetDraft = () => {
    setConnectionDraftRows([createConnectionRow()])
  }

  useEffect(() => {
    if (!isEditing) {
      restoreDrafts()
    }
  }, [existingConnections, isEditing])

  const hasBuildData =
    Array.isArray(salesCombinationEntries) &&
    salesCombinationEntries.length > 0 &&
    Array.isArray(pdfCombinationEntries) &&
    pdfCombinationEntries.length > 0

  const salesById = useMemo(
    () => new Map(salesCombinationEntries.map((row) => [row.id, row])),
    [salesCombinationEntries],
  )
  const pdfById = useMemo(
    () => new Map(pdfCombinationEntries.map((row) => [row.id, row])),
    [pdfCombinationEntries],
  )

  const fetchCombinations = async () => {
    if (!BACKEND_URL) return

    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/combination/`, {
        method: 'GET',
        credentials: 'include',
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCompanyId(null)
        setSalesCombinationEntries([])
        setPdfCombinationEntries([])
        return
      }

      const source =
        data?.data ||
        data?.combinations ||
        data?.results ||
        data?.combination ||
        data ||
        []

      const extracted = extractCombinationState(source)
      setCompanyId(extracted.companyId || null)
      setSalesCombinationEntries(extracted.salesCombinationEntries)
      setPdfCombinationEntries(extracted.pdfCombinationEntries)
    } catch {
      setCompanyId(null)
      setSalesCombinationEntries([])
      setPdfCombinationEntries([])
    }
  }

  const fetchExistingConnections = async (fallbackRows = null) => {
    if (!BACKEND_URL) return

    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/connection`, {
        method: 'GET',
        credentials: 'include',
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setExistingConnections(fallbackRows || [])
        return
      }

      const source =
        data?.data ||
        data?.connections ||
        data?.results ||
        data?.connection ||
        data ||
        []

      const extracted = extractCombinationState(source)
      setExistingConnections(extracted.existingConnections.length ? extracted.existingConnections : fallbackRows || [])
    } catch {
      setExistingConnections(fallbackRows || [])
    }
  }

  useEffect(() => {
    let active = true

    const loadPageData = async () => {
      if (!BACKEND_URL) return

      setLoading(true)
      try {
        await Promise.all([fetchCombinations(), fetchExistingConnections()])
      } finally {
        if (active) setLoading(false)
      }
    }

    loadPageData()

    return () => {
      active = false
    }
  }, [BACKEND_URL])

  const salesConnectionOptions = useMemo(
    () =>
      salesCombinationEntries.map((row) => ({
        label: formatComboForDisplay(row.value),
        value: row.value,
      })),
    [salesCombinationEntries],
  )

  const pdfConnectionOptions = useMemo(
    () =>
      pdfCombinationEntries.map((row) => ({
        label: formatComboForDisplay(row.value),
        value: row.value,
      })),
    [pdfCombinationEntries],
  )

  const savedConnectionRows = useMemo(
    () =>
      existingConnections
        .map((row, index) => {
          const salesLabel =
            salesById.get(row.salesId)?.value || row.salesId || ''
          const pdfLabel =
            pdfById.get(row.pdfId)?.value || row.pdfId || ''
          if (!salesLabel || !pdfLabel) return null

          return {
            key: row.id || `${row.salesId}__${row.pdfId}`,
            index: index + 1,
            salesCombination: formatComboForDisplay(salesLabel),
            pdfCombination: formatComboForDisplay(pdfLabel),
            matchDuplicate: Boolean(row.matchDuplicate),
          }
        })
        .filter(Boolean),
    [existingConnections, salesById, pdfById],
  )

  const addConnectionDraftRow = () => {
    setConnectionDraftRows((prev) => [...prev, createConnectionRow()])
  }

  const updateConnectionDraftRow = (rowId, field, value) => {
    setConnectionDraftRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row
        if (field === 'matchDuplicate') return { ...row, matchDuplicate: Boolean(value) }
        return { ...row, [field]: value || '' }
      }),
    )
  }

  const removeConnectionDraftRow = (rowId) => {
    setConnectionDraftRows((prev) => prev.filter((row) => row.id !== rowId))
  }

  const moveConnectionDraftRow = (rowId, direction) => {
    setConnectionDraftRows((prev) => {
      const currentIndex = prev.findIndex((row) => row.id === rowId)
      if (currentIndex === -1) return prev

      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
      if (targetIndex < 0 || targetIndex >= prev.length) return prev

      const nextRows = [...prev]
      const [movedRow] = nextRows.splice(currentIndex, 1)
      nextRows.splice(targetIndex, 0, movedRow)
      return nextRows
    })
  }

  const handleSave = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }

    if (!hasBuildData) {
      message.error('No Sales/PDF combinations found. Create them first.')
      return
    }

    setSaving(true)
    try {
      const selectedConnectionRows = connectionDraftRows.filter((row) => row.salesId || row.pdfId)

      if (!selectedConnectionRows.length) {
        message.error('Please create at least 1 connection.')
        return
      }

      const hasIncompleteConnection = selectedConnectionRows.some((row) => !row.salesId || !row.pdfId)

      if (hasIncompleteConnection) {
        message.error('Please select both Sales Combination and PDF Combination in each row.')
        return
      }

      const uniqueConnectionRows = Array.from(
        new Map(selectedConnectionRows.map((row) => [`${row.salesId}__${row.pdfId}`, row])).values(),
      )

      const payload = {
        connections: uniqueConnectionRows.map((row, index) => ({
          seq: index + 1,
          salesCombination: row.salesId,
          pdfCombination: row.pdfId,
          matchDuplicate: Boolean(row.matchDuplicate),
        })),
      }

      const res = await fetch(`${BACKEND_URL}/api/company/admin/connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || 'Failed to save connections')
      }

      const responseSource = data?.data || data?.connections || data?.connection || data || []
      const responseState = extractCombinationState(responseSource)

      const fallbackConnections = uniqueConnectionRows.map((row) => ({
        id: `${row.salesId}__${row.pdfId}`,
        salesId: row.salesId,
        pdfId: row.pdfId,
        matchDuplicate: Boolean(row.matchDuplicate),
      }))

      setExistingConnections(
        responseState.existingConnections.length
          ? responseState.existingConnections
          : fallbackConnections,
      )
  
      if (responseState.companyId && !companyId) {
        setCompanyId(responseState.companyId)
      }

      message.success('Connections saved successfully')
      await fetchExistingConnections(fallbackConnections)
      setIsEditing(false)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save connections')
    } finally {
      setSaving(false)
    }
  }

  const savedConnectionColumns = [
    {
      title: '#',
      dataIndex: 'index',
      key: 'index',
      width: 60,
    },
    {
      title: 'Sales Combination',
      dataIndex: 'salesCombination',
      key: 'salesCombination',
      render: (value) => (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
            Sales
          </Tag>
          <Text code style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
            {value || '-'}
          </Text>
        </div>
      ),
    },
    {
      title: 'PDF Combination',
      dataIndex: 'pdfCombination',
      key: 'pdfCombination',
      render: (value) => (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <Tag color="green" style={{ marginInlineEnd: 0 }}>
            PDF
          </Tag>
          <Text code style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
            {value || '-'}
          </Text>
        </div>
      ),
    },
    {
      title: 'Match Duplicate',
      dataIndex: 'matchDuplicate',
      key: 'matchDuplicate',
      width: 130,
      render: (value) =>
        value ? (
          <Tag color="orange">Yes</Tag>
        ) : (
          <Text type="secondary">No</Text>
        ),
    },
  ]

  const connectionTableColumns = [
    {
      title: '#',
      key: 'connection-index',
      width: 60,
      render: (_, __, index) => index + 1,
    },
    {
      title: 'Sales Combination',
      key: 'connection-sales',
      render: (_, record) => (
        <Select
          allowClear
          style={{ width: '100%' }}
          value={record.salesId || undefined}
          options={salesConnectionOptions}
          placeholder="Select Sales combination"
          disabled={!hasBuildData}
          onChange={(value) => updateConnectionDraftRow(record.id, 'salesId', value)}
        />
      ),
    },
    {
      title: 'PDF Combination',
      key: 'connection-pdf',
      render: (_, record) => (
        <Select
          allowClear
          style={{ width: '100%' }}
          value={record.pdfId || undefined}
          options={pdfConnectionOptions}
          placeholder="Select PDF combination"
          disabled={!hasBuildData}
          onChange={(value) => updateConnectionDraftRow(record.id, 'pdfId', value)}
        />
      ),
    },
    {
      title: 'Match Duplicate',
      key: 'connection-match-duplicate',
      width: 150,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Checkbox
            checked={Boolean(record.matchDuplicate)}
            onChange={(event) =>
              updateConnectionDraftRow(record.id, 'matchDuplicate', event.target.checked)
            }
          >
            Match
          </Checkbox>
          {record.matchDuplicate && record.salesId && record.pdfId ? (
            <Tooltip title="Rows match when Sales and PDF selected combination values are equal and the duplicate count is the same on both sides.">
              <Text type="warning" style={{ fontSize: 12 }}>
                <WarningOutlined /> Duplicate matching
              </Text>
            </Tooltip>
          ) : null}
        </Space>
      ),
    },
    {
      title: 'Seq',
      key: 'connection-seq',
      width: 120,
      render: (_, record, index) => (
        <Space size="small">
          <Button
            type="text"
            disabled={index === 0}
            onClick={() => moveConnectionDraftRow(record.id, 'up')}
          >
            Up
          </Button>
          <Button
            type="text"
            disabled={index === connectionDraftRows.length - 1}
            onClick={() => moveConnectionDraftRow(record.id, 'down')}
          >
            Down
          </Button>
        </Space>
      ),
    },
    {
      title: 'X',
      key: 'connection-action',
      width: 64,
      render: (_, record) => (
        <Button type="text" danger onClick={() => removeConnectionDraftRow(record.id)}>
          X
        </Button>
      ),
    },
  ]

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <PageHeader
        title="Connect Combinations"
        description="Map Sales combinations to PDF combinations to link your data accurately."
        actions={
          <AccessControl required="initialization:connection:update">
          <Space wrap>
            {isEditing ? (
              <>
                <Button onClick={resetDraft}>Clear</Button>
                <Button onClick={() => { setIsEditing(false); restoreDrafts(); }}>Cancel</Button>
                <Button type="primary" loading={saving} onClick={handleSave}>Save Changes</Button>
              </>
            ) : (
              <Button type="primary" onClick={() => setIsEditing(true)}>Create Connection</Button>
            )}
          </Space>
          </AccessControl>
        }
      />

      <div style={{ marginTop: 24 }}>
        <div style={sectionCardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <Title level={5} style={{ margin: 0, color: 'var(--exim-gray-800)' }}>
                {isEditing ? 'Create Connections' : 'Existing Connections'}
              </Title>
              <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>
                {isEditing
                  ? 'Select Sales Combination first, then PDF Combination. The request sends only the selected IDs.'
                  : 'Saved rows show labels only, not IDs.'}
              </Text>
            </div>
            <Space wrap>
              {!isEditing ? (
                <>
                  <Tag color="blue">Sales: {salesCombinationEntries.length}</Tag>
                  <Tag color="green">PDF: {pdfCombinationEntries.length}</Tag>
                  <Tag>Connected: {savedConnectionRows.length}</Tag>
                </>
              ) : (
                <>
                  <Tag color="blue">Sales options: {salesConnectionOptions.length}</Tag>
                  <Tag color="green">PDF options: {pdfConnectionOptions.length}</Tag>
                </>
              )}
              {isEditing && (
                <Button onClick={addConnectionDraftRow} disabled={!hasBuildData}>
                  + Add Connection
                </Button>
              )}
            </Space>
          </div>

          {!hasBuildData && !loading && !isEditing ? (
            <Alert
              title="No combinations found"
              description="Create Sales and PDF combinations first on the Combinations page before configuring connections."
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
            />
          ) : null}

          {isEditing && connectionDraftRows.some((row) => row.matchDuplicate) ? (
            <Alert
              type="warning"
              showIcon
              title="Matching duplicate rows"
              description="Checked connections match rows when the combination value is the same on Sales and PDF and the duplicate count is equal on both sides."
              style={{ marginBottom: 16 }}
            />
          ) : null}

          {isEditing ? (
            <Table
              size="small"
              pagination={false}
              columns={connectionTableColumns}
              dataSource={connectionDraftRows.map((row) => ({ ...row, key: row.id }))}
              locale={{ emptyText: 'No connection rows' }}
              scroll={{ x: 800 }}
            />
          ) : (
            <Table
              size="small"
              loading={loading}
              pagination={false}
              columns={savedConnectionColumns}
              dataSource={savedConnectionRows}
              locale={{ emptyText: 'No mapped connections yet' }}
              scroll={{ x: 600 }}
            />
          )}
        </div>
      </div>
    </AppShell>
  )
}
