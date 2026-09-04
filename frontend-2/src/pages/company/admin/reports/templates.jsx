import { ArrowLeftOutlined, HolderOutlined, PlusOutlined, SaveOutlined, ArrowUpOutlined, ArrowDownOutlined, DeleteOutlined, InfoCircleOutlined, EditOutlined } from '@ant-design/icons'
import { Button, Input, InputNumber, Select, Space, Table, Typography, message, Tag, Alert, ConfigProvider, Tooltip } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'
import ProDataTable from '../../../../components/shared/ProDataTable.jsx'
import { AccessControl } from '../../../../components/iam/AccessControl.jsx'

const { Title, Text } = Typography

function normalizeColumnsPayload(payload) {
  if (!payload || typeof payload !== 'object') return {}
  const columnsRaw = payload.columns && typeof payload.columns === 'object' ? payload.columns : {}
  const columnsByType = {}
  for (const [k, v] of Object.entries(columnsRaw)) {
    if (Array.isArray(v)) {
      columnsByType[String(k)] = Array.from(new Set(v.map((x) => String(x).trim()).filter(Boolean)))
    }
  }
  return columnsByType
}

function newSelectedHeaderRow() {
  return {
    key: `hdr-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: undefined,
    sourceHeader: undefined,
    customHeader: '',
    dataType: 'string',
  }
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

function mappingToRows(mapping, mappingItems) {
  if (Array.isArray(mappingItems) && mappingItems.length) {
    return [...mappingItems]
      .sort((a, b) => (Number(a?.seq) || 0) - (Number(b?.seq) || 0))
      .map((item, index) => {
        const rawDataType = String(item?.dataType || item?.columnType || 'string')
          .trim()
          .toLowerCase()
        const dataType = COLUMN_DATA_TYPES.includes(rawDataType) ? rawDataType : 'string'
        return {
          key: `hdr-seq-${item?.seq ?? index}-${Math.random().toString(16).slice(2)}`,
          type: String(item?.type || '').trim() || undefined,
          sourceHeader: String(item?.sourceHeader || '').trim() || undefined,
          customHeader: item?.customHeader == null ? '' : String(item.customHeader),
          dataType,
        }
      })
  }

  if (!mapping || typeof mapping !== 'object') return [newSelectedHeaderRow()]
  const rows = []
  for (const [type, fields] of Object.entries(mapping)) {
    if (!fields || typeof fields !== 'object') continue
    for (const [sourceHeader, customHeader] of Object.entries(fields)) {
      rows.push({
        key: `hdr-${type}-${sourceHeader}-${Math.random().toString(16).slice(2)}`,
        type,
        sourceHeader,
        customHeader: customHeader == null ? '' : String(customHeader),
        dataType: 'string',
      })
    }
  }
  return rows.length ? rows : [newSelectedHeaderRow()]
}

function reorderRowsByKey(prev, fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return prev
  const fromIdx = prev.findIndex((r) => r.key === fromKey)
  const toIdx = prev.findIndex((r) => r.key === toKey)
  if (fromIdx < 0 || toIdx < 0) return prev
  const next = [...prev]
  const [moved] = next.splice(fromIdx, 1)
  next.splice(toIdx, 0, moved)
  return next
}

/** Insert row at target position (1-based); other rows shift — does not swap. */
function moveRowToPosition(prev, rowKey, targetPositionOneBased) {
  const len = prev.length
  if (!len) return prev
  const targetIndex = Math.min(Math.max(1, Math.round(targetPositionOneBased)), len) - 1
  const fromIndex = prev.findIndex((r) => r.key === rowKey)
  if (fromIndex < 0 || fromIndex === targetIndex) return prev
  const next = [...prev]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}

function buildMappingPayload(selectedRows) {
  const mappingItems = []
  let seq = 0
  for (const row of selectedRows) {
    const sourceHeader = String(row.sourceHeader || '').trim()
    const customHeader = String(row.customHeader || '').trim()
    const type = String(row.type || '').trim()
    if (!sourceHeader || !type) continue
    const rawDataType = String(row.dataType || 'string').trim().toLowerCase()
    const dataType = COLUMN_DATA_TYPES.includes(rawDataType) ? rawDataType : 'string'
    seq += 1
    mappingItems.push({
      seq,
      type,
      sourceHeader,
      customHeader: customHeader || sourceHeader,
      dataType,
    })
  }

  const mapping = mappingItems.reduce((acc, item) => {
    if (!acc[item.type]) acc[item.type] = {}
    acc[item.type][item.sourceHeader] = item.customHeader
    return acc
  }, {})

  return { mapping, mappingItems }
}

const COLUMN_DATA_TYPES = ['string', 'number', 'decimal', 'date']

const COLUMN_DATA_TYPE_OPTIONS = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'decimal', label: 'Decimal' },
  { value: 'date', label: 'Date' },
]

export default function CompanyAdminReportTemplatesPage() {
  const navigate = useNavigate()
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')
  const draggedRowKeyRef = useRef(null)

  const [loadingColumns, setLoadingColumns] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [columnsByType, setColumnsByType] = useState({})
  
  const [isEditing, setIsEditing] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [selectedRows, setSelectedRows] = useState([newSelectedHeaderRow()])
  
  const [refreshKey, setRefreshKey] = useState(0)
  const [loadingTemplateDetails, setLoadingTemplateDetails] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState(undefined)
  const [moveToDraft, setMoveToDraft] = useState({})

  const reportTypes = useMemo(() => Object.keys(columnsByType), [columnsByType])

  const fetchColumns = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoadingColumns(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/report/columns`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load columns (${res.status})`)
      }
      const normalized = normalizeColumnsPayload(data)
      setColumnsByType(normalized)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load template columns')
    } finally {
      setLoadingColumns(false)
    }
  }, [BACKEND_URL])

  useEffect(() => {
    fetchColumns()
  }, [fetchColumns])

  const fetchTemplatesData = useCallback(async (params) => {
    if (!BACKEND_URL) return { data: [], total: 0 }
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
      return {
        data: rows,
        total: rows.length,
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load templates')
      return { data: [], total: 0 }
    }
  }, [BACKEND_URL])

  const typeOptions = useMemo(
    () =>
      reportTypes.map((t) => ({
        value: t,
        label: String(t).toUpperCase(),
      })),
    [reportTypes],
  )

  const usedPairSet = useMemo(() => {
    const set = new Set()
    for (const row of selectedRows) {
      if (row.type && row.sourceHeader) {
        set.add(`${row.type}::${row.sourceHeader}`)
      }
    }
    return set
  }, [selectedRows])

  const updateRow = useCallback((rowKey, patch) => {
    setSelectedRows((prev) => prev.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)))
  }, [])

  const removeRow = useCallback((rowKey) => {
    setSelectedRows((prev) => {
      const next = prev.filter((row) => row.key !== rowKey)
      return next.length ? next : [newSelectedHeaderRow()]
    })
  }, [])

  const addRow = useCallback(() => {
    setSelectedRows((prev) => [...prev, newSelectedHeaderRow()])
  }, [])

  const moveRow = useCallback((rowKey, direction) => {
    setSelectedRows((prev) => {
      const currentIndex = prev.findIndex((row) => row.key === rowKey)
      if (currentIndex === -1) return prev
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
      if (targetIndex < 0 || targetIndex >= prev.length) return prev
      const nextRows = [...prev]
      const [movedRow] = nextRows.splice(currentIndex, 1)
      nextRows.splice(targetIndex, 0, movedRow)
      return nextRows
    })
  }, [])

  const getTableRowProps = useCallback(
    (record) => ({
      onDragOver: (e) => {
        if (!draggedRowKeyRef.current) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      },
      onDrop: (e) => {
        e.preventDefault()
        const fromKey = draggedRowKeyRef.current
        draggedRowKeyRef.current = null
        if (!fromKey || fromKey === record.key) return
        setSelectedRows((prev) => reorderRowsByKey(prev, fromKey, record.key))
      },
    }),
    [],
  )

  const applyMoveToPosition = useCallback(
    (rowKey, currentIndex) => {
      const raw = moveToDraft[rowKey]
      const target = Number(raw ?? currentIndex + 1)
      if (!Number.isFinite(target) || target < 1) {
        message.warning('Enter a position number (1 or higher).')
        return
      }
      setSelectedRows((prev) => {
        const clamped = Math.min(Math.max(1, Math.round(target)), prev.length)
        const next = moveRowToPosition(prev, rowKey, clamped)
        if (next === prev) return prev
        message.success(`Row moved to position ${clamped}.`)
        return next
      })
      setMoveToDraft((prev) => {
        const next = { ...prev }
        delete next[rowKey]
        return next
      })
    },
    [moveToDraft],
  )

  const resetForm = useCallback(() => {
    setTemplateName('')
    setSelectedTemplateId(undefined)
    setSelectedRows([newSelectedHeaderRow()])
    setMoveToDraft({})
    setIsEditing(false)
  }, [])

  const mappingPayload = useMemo(() => buildMappingPayload(selectedRows), [selectedRows])

  const handleSaveTemplate = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!mappingPayload.mappingItems.length) {
      message.warning('Select at least one header.')
      return
    }
    setSavingTemplate(true)
    try {
      const body = {
        templateName: templateName.trim() || undefined,
        mapping: mappingPayload.mapping,
        mappingItems: mappingPayload.mappingItems,
      }
      const res = await fetch(`${BACKEND_URL}/api/company/admin/report/create-templates`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to create template (${res.status})`)
      }
      message.success(data?.message || 'Template created successfully.')
      setRefreshKey(prev => prev + 1)
      resetForm()
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to create template')
    } finally {
      setSavingTemplate(false)
    }
  }, [BACKEND_URL, mappingPayload, resetForm, templateName])

  const fetchTemplateById = useCallback(
    async (id) => {
      if (!BACKEND_URL || !id) return
      setLoadingTemplateDetails(true)
      try {
        const res = await fetch(`${BACKEND_URL}/api/company/admin/report/template-by-id`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.detail || data?.message || `Failed to load template details (${res.status})`)
        }
        const template = normalizeTemplateDetailsPayload(data)
        setSelectedTemplateId(String(template.id || id))
        setTemplateName(String(template.templateName || ''))
        setSelectedRows(mappingToRows(template.mapping, template.mappingItems))
        setIsEditing(true)
      } catch (e) {
        message.error(e instanceof Error ? e.message : 'Failed to load template details')
      } finally {
        setLoadingTemplateDetails(false)
      }
    },
    [BACKEND_URL],
  )

  const handleUpdateTemplate = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!selectedTemplateId) {
      message.warning('Select a template first.')
      return
    }
    if (!mappingPayload.mappingItems.length) {
      message.warning('Select at least one header.')
      return
    }

    setSavingTemplate(true)
    try {
      const body = {
        id: selectedTemplateId,
        templateName: templateName.trim() || undefined,
        mapping: mappingPayload.mapping,
        mappingItems: mappingPayload.mappingItems,
      }

      const res = await fetch(`${BACKEND_URL}/api/company/admin/report/update-template`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to update template (${res.status})`)
      }
      message.success(data?.message || 'Template updated successfully.')
      setRefreshKey(prev => prev + 1)
      resetForm()
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to update template')
    } finally {
      setSavingTemplate(false)
    }
  }, [BACKEND_URL, mappingPayload, resetForm, selectedTemplateId, templateName])

  const columns = useMemo(
    () => [
      {
        title: '',
        key: 'drag',
        width: 44,
        align: 'center',
        render: (_, record) => (
          <span
            draggable
            role="button"
            tabIndex={0}
            aria-label="Drag to reorder row"
            onDragStart={(e) => {
              draggedRowKeyRef.current = record.key
              try {
                e.dataTransfer.setData('text/plain', record.key)
              } catch {
                /* ignore */
              }
              e.dataTransfer.effectAllowed = 'move'
              e.stopPropagation()
            }}
            onDragEnd={() => {
              draggedRowKeyRef.current = null
            }}
            style={{
              cursor: 'grab',
              color: 'rgba(0,0,0,0.45)',
              display: 'inline-flex',
              alignItems: 'center',
              padding: '4px 2px',
              touchAction: 'none',
            }}
          >
            <HolderOutlined />
          </span>
        ),
      },
      {
        title: 'Seq',
        key: 'seq',
        width: 56,
        align: 'center',
        render: (_, __, index) => index + 1,
      },
      {
        title: 'Type',
        dataIndex: 'type',
        key: 'type',
        width: 150,
        render: (_, row) => (
          <Select
            value={row.type}
            placeholder="Select type"
            style={{ width: '100%' }}
            options={typeOptions}
            onChange={(value) =>
              updateRow(row.key, {
                type: value,
                sourceHeader: undefined,
                customHeader: '',
              })
            }
          />
        ),
      },
      {
        title: 'Header',
        dataIndex: 'sourceHeader',
        key: 'sourceHeader',
        width: 360,
        render: (_, row) => {
          const allHeaders = row.type ? columnsByType[row.type] || [] : []
          const headerOptions = allHeaders
            .filter((header) => {
              const pair = `${row.type}::${header}`
              return !usedPairSet.has(pair) || row.sourceHeader === header
            })
            .map((header) => ({ value: header, label: header }))
          return (
            <Select
              value={row.sourceHeader}
              placeholder={row.type ? 'Select header' : 'Select type first'}
              style={{ width: '100%' }}
              options={headerOptions}
              disabled={!row.type}
              showSearch
              optionFilterProp="label"
              onChange={(value) =>
                updateRow(row.key, {
                  sourceHeader: value,
                  customHeader: row.customHeader || value,
                })
              }
            />
          )
        },
      },
      {
        title: 'Rename Header',
        dataIndex: 'customHeader',
        key: 'customHeader',
        width: 280,
        render: (_, row) => (
          <Input
            value={row.customHeader}
            placeholder={row.sourceHeader ? `Rename ${row.sourceHeader}` : 'Choose header first'}
            disabled={!row.sourceHeader}
            onChange={(e) => updateRow(row.key, { customHeader: e.target.value })}
          />
        ),
      },
      {
        title: 'Data Type',
        dataIndex: 'dataType',
        key: 'dataType',
        width: 130,
        render: (_, row) => (
          <Select
            value={row.dataType || 'string'}
            placeholder="Type"
            style={{ width: '100%' }}
            options={COLUMN_DATA_TYPE_OPTIONS}
            onChange={(value) => updateRow(row.key, { dataType: value || 'string' })}
          />
        ),
      },
      {
        title: 'Move to #',
        key: 'moveTo',
        width: 150,
        render: (_, row, index) => (
          <Space size={4} wrap={false}>
            <InputNumber
              min={1}
              max={selectedRows.length}
              precision={0}
              value={moveToDraft[row.key] ?? index + 1}
              onChange={(value) =>
                setMoveToDraft((prev) => ({
                  ...prev,
                  [row.key]: value == null ? index + 1 : value,
                }))
              }
              onPressEnter={() => applyMoveToPosition(row.key, index)}
              style={{ width: 64 }}
            />
            <Button size="small" type="default" onClick={() => applyMoveToPosition(row.key, index)} style={{ color: 'var(--exim-primary)', borderColor: 'var(--exim-primary-100)', background: 'var(--exim-primary-50)' }}>
              Go
            </Button>
          </Space>
        ),
      },
      {
        title: 'Order',
        key: 'order',
        width: 80,
        render: (_, row, index) => (
          <Space size="small" wrap={false}>
            <Button type="text" size="small" icon={<ArrowUpOutlined style={{ fontSize: 12 }} />} disabled={index === 0} onClick={() => moveRow(row.key, 'up')} style={{ color: 'var(--exim-gray-500)' }} />
            <Button type="text" size="small" icon={<ArrowDownOutlined style={{ fontSize: 12 }} />} disabled={index === selectedRows.length - 1} onClick={() => moveRow(row.key, 'down')} style={{ color: 'var(--exim-gray-500)' }} />
          </Space>
        ),
      },
      {
        title: 'Action',
        key: 'action',
        width: 64,
        align: 'center',
        render: (_, row) => (
          <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => removeRow(row.key)} />
        ),
      },
    ],
    [
      applyMoveToPosition,
      columnsByType,
      moveRow,
      moveToDraft,
      removeRow,
      selectedRows.length,
      typeOptions,
      updateRow,
      usedPairSet,
    ],
  )

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <PageHeader
        title={isEditing ? (selectedTemplateId ? 'Update Template' : 'Create Template') : 'Report Templates'}
        description={isEditing 
          ? "Build your report template by mapping standard headers to your custom formats."
          : "Select report headers and rename them before creating custom report templates."}
        actions={
          !isEditing && (
            <Space>
              <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/reports')}>
                Back to Reports
              </Button>
            </Space>
          )
        }
      />

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {!isEditing ? (
          <ProDataTable
            fetchData={fetchTemplatesData}
            refreshKey={refreshKey}
            globalSearchPlaceholder="Search templates by name..."
            rowKey={(row) => String(row.id || row._id || '')}
            showSelectionColumn={false}
            customToolbarActions={
              <AccessControl required="analytics:report_templates:create">
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsEditing(true)} loading={loadingColumns}>
                Create Template
                </Button>
              </AccessControl>
              
            }
            columns={[
              {
                title: 'Template Name',
                dataIndex: 'templateName',
                key: 'templateName',
                render: (value) => <Text strong>{String(value || '-')}</Text>,
              },
              {
                title: 'ID',
                dataIndex: 'id',
                key: 'id',
                render: (_, row) => (
                  <Text code style={{ fontSize: 11 }}>{String(row.id || row._id || '-')}</Text>
                ),
              },
              {
                title: 'Created',
                dataIndex: 'createdAt',
                key: 'createdAt',
                render: (value) => {
                  if (!value) return '-'
                  const d = new Date(value)
                  const formatted = isNaN(d.getTime()) ? String(value) : d.toLocaleString('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                  return <Text type="secondary" style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{formatted}</Text>
                },
              },
              {
                title: 'Updated',
                dataIndex: 'updatedAt',
                key: 'updatedAt',
                render: (value) => {
                  if (!value) return '-'
                  const d = new Date(value)
                  const formatted = isNaN(d.getTime()) ? String(value) : d.toLocaleString('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                  return <Text type="secondary" style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{formatted}</Text>
                },
              },
              {
                title: 'Action',
                key: 'action',
                align: 'center',
                render: (_, row) => (
                  <AccessControl required="analytics:report_templates:edit">
                    <Button
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => fetchTemplateById(String(row.id || row._id || ''))}
                    disabled={!row.id && !row._id}
                    style={{ color: '#2563eb' }}
                  />
                  </AccessControl>
                  
                ),
              },
              {
                title: '',
                key: 'filler',
              },
            ]}
          />
        ) : (
          <ConfigProvider
            theme={{
              token: {
                colorPrimary: '#2563eb',
                borderRadius: 6,
                colorText: '#1e293b',
              },
              components: {
                Input: {
                  colorBgContainer: '#f8fafc',
                  colorBorder: '#cbd5e1',
                  hoverBorderColor: '#94a3b8',
                  activeBorderColor: '#2563eb',
                  activeShadow: '0 0 0 2px rgba(37, 99, 235, 0.1)',
                },
                Select: {
                  colorBgContainer: '#f8fafc',
                  colorBorder: '#cbd5e1',
                  hoverBorderColor: '#94a3b8',
                  activeBorderColor: '#2563eb',
                  activeShadow: '0 0 0 2px rgba(37, 99, 235, 0.1)',
                },
                Table: {
                  headerBg: '#f1f5f9',
                  headerColor: '#334155',
                  headerBorderRadius: 8,
                  borderColor: '#e2e8f0',
                  rowHoverBg: '#f8fafc',
                  cellPaddingBlock: 12,
                },
                Button: {
                  primaryColor: '#ffffff',
                  colorPrimary: '#2563eb',
                  colorPrimaryHover: '#1d4ed8',
                  colorPrimaryActive: '#1e40af',
                }
              }
            }}
          >
            <div style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: 24,
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)',
              border: '1px solid #e2e8f0',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                
                <div style={{ maxWidth: 640 }}>
                  <Text style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Template Name
                  </Text>
                  <Input
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="e.g. Monthly Export Template"
                    size="large"
                    style={{ borderRadius: 8, fontSize: 15 }}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
                    <div>
                      <Space align="center" size="small">
                        <Typography.Title level={5} style={{ margin: 0, color: '#0f172a', fontWeight: 600, fontSize: 18 }}>
                          Template Columns
                        </Typography.Title>
                        <Tooltip title="Drag the handle, use Move to # + Go, or Up/Down to reorder. Data Type sets the Excel cell format." placement="right">
                          <Button type="text" shape="circle" size="small" icon={<InfoCircleOutlined style={{ color: '#94a3b8' }} />} style={{ marginTop: 2 }} />
                        </Tooltip>
                      </Space>
                      <div style={{ marginTop: 2 }}>
                        <Text type="secondary" style={{ fontSize: 13, color: '#64748b' }}>Configure the exact output format for your Excel report.</Text>
                      </div>
                    </div>
                  </div>
                  
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)' }}>
                    <Table
                      size="middle"
                      rowKey="key"
                      columns={columns}
                      dataSource={selectedRows}
                      pagination={false}
                      scroll={{ x: 'max-content' }}
                      onRow={getTableRowProps}
                      locale={{ emptyText: 'No columns added yet' }}
                      className="enterprise-table custom-scrollbar"
                    />
                  </div>
                  
                  <Button
                    type="dashed"
                    onClick={addRow}
                    icon={<PlusOutlined />}
                    style={{
                      width: '100%',
                      marginTop: 12,
                      height: 40,
                      borderRadius: 8,
                      color: '#64748b',
                      borderColor: '#cbd5e1',
                      fontWeight: 500,
                    }}
                  >
                    Add Header Row
                  </Button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
                  <Space size="middle">
                    <Button onClick={resetForm} size="large" style={{ borderRadius: 8, fontWeight: 500 }}>
                      Cancel
                    </Button>
                    <Button
                      type="primary"
                      size="large"
                      loading={savingTemplate}
                      onClick={selectedTemplateId ? handleUpdateTemplate : handleSaveTemplate}
                      style={{ borderRadius: 8, fontWeight: 500, boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)' }}
                    >
                      {selectedTemplateId ? 'Update Template' : 'Save Template'}
                    </Button>
                  </Space>
                </div>

              </div>
            </div>
          </ConfigProvider>
        )}
      </Space>
    </AppShell>
  )
}
