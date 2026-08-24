import { ArrowLeftOutlined, HolderOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import { Button, Input, InputNumber, Layout, Modal, Select, Space, Table, Typography, message } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
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
  const [modalOpen, setModalOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [selectedRows, setSelectedRows] = useState([newSelectedHeaderRow()])
  const [templates, setTemplates] = useState([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
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

  const resetModal = useCallback(() => {
    setTemplateName('')
    setSelectedRows([newSelectedHeaderRow()])
    setSelectedTemplateId(undefined)
    setMoveToDraft({})
    setModalOpen(false)
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
      resetModal()
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to create template')
    } finally {
      setSavingTemplate(false)
    }
  }, [BACKEND_URL, mappingPayload, resetModal, templateName])

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
        setModalOpen(true)
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
      await fetchTemplates()
      resetModal()
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to update template')
    } finally {
      setSavingTemplate(false)
    }
  }, [BACKEND_URL, fetchTemplates, mappingPayload, resetModal, selectedTemplateId, templateName])

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
        width: 168,
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
              style={{ width: 72 }}
            />
            <Button size="small" type="primary" ghost onClick={() => applyMoveToPosition(row.key, index)}>
              Go
            </Button>
          </Space>
        ),
      },
      {
        title: 'Order',
        key: 'order',
        width: 120,
        render: (_, row, index) => (
          <Space size="small">
            <Button type="text" disabled={index === 0} onClick={() => moveRow(row.key, 'up')}>
              Up
            </Button>
            <Button
              type="text"
              disabled={index === selectedRows.length - 1}
              onClick={() => moveRow(row.key, 'down')}
            >
              Down
            </Button>
          </Space>
        ),
      },
      {
        title: 'Action',
        key: 'action',
        width: 100,
        render: (_, row) => (
          <Button danger type="link" onClick={() => removeRow(row.key)}>
            Remove
          </Button>
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
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
              <div>
                <Title level={3} style={{ margin: 0 }}>
                  Report Templates
                </Title>
                <Text type="secondary">Select report headers and rename them before creating templates.</Text>
              </div>
              <Space>
                <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/reports')}>
                  Back to Reports
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)} loading={loadingColumns}>
                  Create Templates
                </Button>
              </Space>
            </Space>

            <Text type="secondary">
              Available types: {reportTypes.length ? reportTypes.map((t) => t.toUpperCase()).join(', ') : 'No type found'}
            </Text>

            <Table
              size="small"
              rowKey={(row, index) => String(row.id || row._id || `${row.templateName || 'template'}-${index}`)}
              loading={loadingTemplates || loadingTemplateDetails}
              pagination={{ pageSize: 10, showSizeChanger: true }}
              dataSource={templates}
              columns={[
                {
                  title: 'Template Name',
                  dataIndex: 'templateName',
                  key: 'templateName',
                  render: (value) => String(value || '-'),
                },
                {
                  title: 'ID',
                  dataIndex: 'id',
                  key: 'id',
                  render: (_, row) => String(row.id || row._id || '-'),
                },
                {
                  title: 'Created',
                  dataIndex: 'createdAt',
                  key: 'createdAt',
                  render: (value) => String(value || '-'),
                },
                {
                  title: 'Updated',
                  dataIndex: 'updatedAt',
                  key: 'updatedAt',
                  render: (value) => String(value || '-'),
                },
                {
                  title: 'Action',
                  key: 'action',
                  width: 120,
                  render: (_, row) => (
                    <Button
                      type="link"
                      onClick={() => fetchTemplateById(String(row.id || row._id || ''))}
                      disabled={!row.id && !row._id}
                    >
                      Edit
                    </Button>
                  ),
                },
              ]}
            />
          </Space>
        

      <Modal
        title={selectedTemplateId ? 'Update Template' : 'Create Template'}
        open={modalOpen}
        width="92vw"
        style={{ top: 24, maxWidth: 1400 }}
        styles={{ body: { maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' } }}
        onCancel={resetModal}
        onOk={selectedTemplateId ? handleUpdateTemplate : handleSaveTemplate}
        okText={selectedTemplateId ? 'Update Template' : 'Save Template'}
        okButtonProps={{ icon: <SaveOutlined />, loading: savingTemplate }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              Template name (optional)
            </Text>
            <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Example: Monthly Export Template" />
          </div>

          <Text type="secondary" style={{ display: 'block' }}>
            Drag the <HolderOutlined /> handle, use <b>Move to #</b> + Go (inserts at that position — other rows
            shift; rows are not swapped), or use Up / Down. <b>Data Type</b> sets the Excel cell type: Date →
            date cell (DD/MM/YYYY), Number → numeric cell, Decimal → numeric cell (0.00).
          </Text>

          <Table
            size="small"
            rowKey="key"
            columns={columns}
            dataSource={selectedRows}
            pagination={false}
            scroll={{ x: 1280 }}
            onRow={getTableRowProps}
          />

          <div>
            <Button onClick={addRow}>+ Add Header Row</Button>
          </div>
        </Space>
      </Modal>
    </AppShell>
  )
}
