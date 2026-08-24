import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  HolderOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { Button, Input, Layout, Select, Space, Table, Typography, message } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography

const DROPDOWN_OPTIONS = [
  { label: 'Current Date', value: 'current_date' },
  { label: 'Insert Default Value', value: 'default_value' },
  { label: 'Blank Default Value', value: 'blank_default_value' },
]

const HORIZONTAL_DROPDOWN_OPTIONS = [{ label: 'Current Date', value: 'current_date' }]

const ROUND_OPTIONS = [
  { label: 'Round', value: 'round' },
  { label: 'Round Up', value: 'round_up' },
  { label: 'Round Down', value: 'round_down' },
]

const SYSTEM_HEADERS = [
  'POSTING_KEY',
  'ACCOUNT_NO',
  'SAL_AMOUNT',
  'ASSIGNMENT',
  'SHORT_TEXT',
  'BUSINESS_AREA',
]

function createSystemRow(headerName) {
  return {
    key: `system-${headerName}`,
    value: headerName,
    renameHeader: '',
    selected: 'default_value',
    defaultValue: 'Auto added by software',
    round: undefined,
    locked: true,
  }
}

function createRow() {
  return {
    key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    value: '',
    renameHeader: '',
    selected: undefined,
    defaultValue: '',
    round: undefined,
    locked: false,
  }
}

function swapRowsByIndex(prev, i, j) {
  if (i < 0 || j < 0 || i >= prev.length || j >= prev.length) return prev
  const next = [...prev]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
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

export default function CompanyAdminJvDbkFormatPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')
  const draggedMappingKeyRef = useRef(null)
  const [postingAccounts, setPostingAccounts] = useState([
    {
      key: `pa-${Date.now()}`,
      postingKey: '',
      accountNo: '',
    },
  ])
  const [rows, setRows] = useState(() => [...SYSTEM_HEADERS.map(createSystemRow), createRow()])
  const [horizontalRows, setHorizontalRows] = useState([{ key: `h-${Date.now()}` }])
  const [submitting, setSubmitting] = useState(false)
  const [loadingFormat, setLoadingFormat] = useState(false)
  const [formatMode, setFormatMode] = useState('create') // create | update

  const moveMappingRow = useCallback((key, direction) => {
    setRows((prev) => {
      const i = prev.findIndex((r) => r.key === key)
      if (i < 0) return prev
      if (direction === 'up') {
        if (i === 0) return prev
        return swapRowsByIndex(prev, i - 1, i)
      }
      if (direction === 'down') {
        if (i >= prev.length - 1) return prev
        return swapRowsByIndex(prev, i, i + 1)
      }
      return prev
    })
  }, [])

  const getMappingTableRowProps = useCallback((record) => ({
    onDragOver: (e) => {
      if (!draggedMappingKeyRef.current) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    },
    onDrop: (e) => {
      e.preventDefault()
      const fromKey = draggedMappingKeyRef.current
      draggedMappingKeyRef.current = null
      if (!fromKey || fromKey === record.key) return
      setRows((prev) => reorderRowsByKey(prev, fromKey, record.key))
    },
  }), [])

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
              draggedMappingKeyRef.current = record.key
              try {
                e.dataTransfer.setData('text/plain', record.key)
              } catch {
                /* ignore */
              }
              e.dataTransfer.effectAllowed = 'move'
              e.stopPropagation()
            }}
            onDragEnd={() => {
              draggedMappingKeyRef.current = null
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
        width: 72,
        render: (_, __, index) => index + 1,
      },
      {
        title: 'Header Name',
        dataIndex: 'value',
        key: 'value',
        width: 320,
        render: (_, record) => (
          <Input
            value={record.value}
            placeholder="Enter header name"
            onChange={(e) =>
              setRows((prev) =>
                prev.map((r) => (r.key === record.key ? { ...r, value: e.target.value } : r)),
              )
            }
            readOnly={record.locked}
          />
        ),
      },
      {
        title: 'Header Value',
        dataIndex: 'selected',
        key: 'selected',
        width: 320,
        render: (_, record) => (
          <Select
            style={{ width: '100%' }}
            placeholder="Select header value"
            options={DROPDOWN_OPTIONS}
            value={record.selected}
            onChange={(next) =>
              setRows((prev) =>
                prev.map((r) =>
                  r.key === record.key
                    ? {
                        ...r,
                        selected: next,
                        defaultValue: next === 'default_value' ? r.defaultValue : '',
                      }
                    : r,
                ),
              )
            }
            allowClear
            disabled={record.locked}
          />
        ),
      },
      {
        title: 'Rename Header',
        dataIndex: 'renameHeader',
        key: 'renameHeader',
        width: 280,
        render: (_, record) => (
          <Input
            value={record.renameHeader}
            placeholder={record.locked ? 'Rename predefined header' : 'Optional rename'}
            onChange={(e) =>
              setRows((prev) =>
                prev.map((r) => (r.key === record.key ? { ...r, renameHeader: e.target.value } : r)),
              )
            }
          />
        ),
      },
      {
        title: 'Default Value',
        dataIndex: 'defaultValue',
        key: 'defaultValue',
        width: 320,
        render: (_, record) => {
          if (record.selected === 'default_value') {
            return (
            <Input
              value={record.defaultValue}
              placeholder="Enter default value"
              onChange={(e) =>
                setRows((prev) =>
                  prev.map((r) => (r.key === record.key ? { ...r, defaultValue: e.target.value } : r)),
                )
              }
              readOnly={record.locked}
            />
            )
          }
          if (record.selected === 'current_date') {
            const today = new Date().toLocaleDateString()
            return (
              <Space direction="vertical" size={0}>
                <Text>{today}</Text>
                <Text type="warning" style={{ fontSize: 12 }}>
                  Current Date is dynamic. Actual run-date will be used automatically.
                </Text>
              </Space>
            )
          }
          return (
            <Text type="secondary">—</Text>
          )
        },
      },
      {
        title: 'Round',
        dataIndex: 'round',
        key: 'round',
        width: 200,
        render: (_, record) => (
          <Select
            style={{ width: '100%' }}
            placeholder="No rounding"
            options={ROUND_OPTIONS}
            value={record.round}
            allowClear
            onChange={(next) =>
              setRows((prev) =>
                prev.map((r) => (r.key === record.key ? { ...r, round: next || undefined } : r)),
              )
            }
          />
        ),
      },
      {
        title: 'Action',
        key: 'action',
        width: 160,
        render: (_, record, index) => {
          const canUp = index > 0
          const canDown = index < rows.length - 1
          return (
            <Space size={0}>
              <Button
                type="text"
                size="small"
                icon={<ArrowUpOutlined />}
                disabled={!canUp}
                aria-label="Move row up"
                onClick={() => moveMappingRow(record.key, 'up')}
              />
              <Button
                type="text"
                size="small"
                icon={<ArrowDownOutlined />}
                disabled={!canDown}
                aria-label="Move row down"
                onClick={() => moveMappingRow(record.key, 'down')}
              />
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => setRows((prev) => prev.filter((r) => r.key !== record.key))}
                disabled={record.locked || rows.length <= SYSTEM_HEADERS.length + 1}
                aria-label="Delete row"
              />
            </Space>
          )
        },
      },
    ],
    [moveMappingRow, rows],
  )

  const postingColumns = useMemo(
    () => [
      {
        title: 'Index No',
        key: 'index',
        width: 90,
        render: (_, __, index) => index + 1,
      },
      {
        title: 'POSTING_KEY',
        dataIndex: 'postingKey',
        key: 'postingKey',
        width: 280,
        render: (_, record) => (
          <Input
            value={record.postingKey}
            onChange={(e) =>
              setPostingAccounts((prev) =>
                prev.map((r) => (r.key === record.key ? { ...r, postingKey: e.target.value } : r)),
              )
            }
            placeholder="Enter POSTING_KEY"
          />
        ),
      },
      {
        title: 'ACCOUNT_NO',
        dataIndex: 'accountNo',
        key: 'accountNo',
        width: 280,
        render: (_, record) => (
          <Input
            value={record.accountNo}
            onChange={(e) =>
              setPostingAccounts((prev) =>
                prev.map((r) => (r.key === record.key ? { ...r, accountNo: e.target.value } : r)),
              )
            }
            placeholder="Enter ACCOUNT_NO"
          />
        ),
      },
      {
        title: 'Action',
        key: 'action',
        width: 90,
        render: (_, record) => (
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            aria-label="Delete posting/account row"
            disabled={postingAccounts.length <= 1}
            onClick={() => setPostingAccounts((prev) => prev.filter((r) => r.key !== record.key))}
          />
        ),
      },
    ],
    [postingAccounts.length],
  )

  const horizontalHeaderColumns = useMemo(() => {
    const headerDefs = rows
      .map((r) => {
        const key = String(r.value || '').trim()
        if (!key) return null
        const label = String(r.renameHeader || '').trim() || key
        return { dataKey: key, title: label }
      })
      .filter(Boolean)

    const deduped = []
    const seen = new Set()
    for (const h of headerDefs) {
      if (seen.has(h.dataKey)) continue
      seen.add(h.dataKey)
      deduped.push(h)
    }

    const cols = deduped.map((h) => ({
      title: h.title,
      dataIndex: h.dataKey,
      key: h.dataKey,
      width: 220,
      onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      render: (_, record) => {
        const rawValue = record[h.dataKey]
        const isCurrentDate = rawValue === 'current_date'
        return (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Select
              style={{ width: '100%' }}
              placeholder="Select special value"
              options={HORIZONTAL_DROPDOWN_OPTIONS}
              value={isCurrentDate ? 'current_date' : undefined}
              allowClear
              onChange={(next) =>
                setHorizontalRows((prev) =>
                  prev.map((row) => (row.key === record.key ? { ...row, [h.dataKey]: next || '' } : row)),
                )
              }
            />
            {isCurrentDate ? (
              <Space direction="vertical" size={0}>
                <Text>{new Date().toLocaleDateString()}</Text>
                <Text type="warning" style={{ fontSize: 12 }}>
                  Current Date is dynamic. Actual run-date will be used automatically.
                </Text>
              </Space>
            ) : (
              <Input
                value={rawValue ?? ''}
                placeholder="Enter value"
                onChange={(e) =>
                  setHorizontalRows((prev) =>
                    prev.map((row) => (row.key === record.key ? { ...row, [h.dataKey]: e.target.value } : row)),
                  )
                }
              />
            )}
          </Space>
        )
      },
    }))

    return [
      {
        title: 'Row',
        key: 'row',
        width: 80,
        fixed: 'left',
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        render: (_, __, idx) => idx + 1,
      },
      ...cols,
    ]
  }, [rows])

  const addHorizontalRow = useCallback(() => {
    setHorizontalRows((prev) => [...prev, { key: `h-${Date.now()}-${Math.random().toString(16).slice(2)}` }])
  }, [])

  const insertHorizontalDefaultRow = useCallback(() => {
    const next = { key: `h-${Date.now()}-${Math.random().toString(16).slice(2)}` }
    rows.forEach((r) => {
      const k = String(r.value || '').trim()
      if (!k) return
      if (r.selected === 'default_value') {
        next[k] = String(r.defaultValue || '')
      } else if (r.selected === 'current_date') {
        next[k] = new Date().toLocaleDateString()
      } else {
        next[k] = ''
      }
    })
    setHorizontalRows((prev) => [...prev, next])
  }, [rows])

  useEffect(() => {
    let mounted = true

    const fetchFormat = async () => {
      if (!BACKEND_URL) return
      setLoadingFormat(true)
      try {
        const res = await fetch(`${BACKEND_URL}/api/company/admin/jv/jv-dbk-format`, {
          method: 'GET',
          credentials: 'include',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (res.status === 404) {
            if (mounted) setFormatMode('create')
            return
          }
          throw new Error(data?.detail || data?.message || `Failed to load JV DBK format (${res.status})`)
        }

        const payload = data?.data && typeof data.data === 'object' ? data.data : data
        const incomingPosting = Array.isArray(payload?.postingAccounts)
          ? payload.postingAccounts
          : Array.isArray(payload?.posting_accounts)
            ? payload.posting_accounts
            : []
        const rawMappings = Array.isArray(payload?.headerMappings)
          ? payload.headerMappings
          : Array.isArray(payload?.header_mappings)
            ? payload.header_mappings
            : []
        const incomingMappings = [...rawMappings].sort((a, b) => {
          const sa = Number(a?.seq ?? a?.sequence ?? 0) || 0
          const sb = Number(b?.seq ?? b?.sequence ?? 0) || 0
          return sa - sb
        })

        if (incomingPosting.length) {
          const normalizedPosting = incomingPosting.map((r, idx) => ({
            key: `pa-loaded-${idx}-${Math.random().toString(16).slice(2)}`,
            postingKey: String(r?.POSTING_KEY ?? r?.postingKey ?? ''),
            accountNo: String(r?.ACCOUNT_NO ?? r?.accountNo ?? ''),
          }))
          if (mounted) setPostingAccounts(normalizedPosting)
        }

        if (incomingMappings.length) {
          const mappedRows = incomingMappings
            .map((r, idx) => {
              const headerName = String(r?.headerName ?? r?.header_name ?? '').trim()
              const headerValueType = String(r?.headerValueType ?? r?.header_value_type ?? '').trim()
              const defaultValue = String(r?.defaultValue ?? r?.default_value ?? '')
              const renameHeader = String(
                r?.renameHeader ?? r?.rename_header ?? r?.columnRename ?? r?.column_rename ?? '',
              )
              const round = String(r?.round ?? r?.roundMode ?? r?.round_mode ?? '').trim()
              if (!headerName || !headerValueType) return null
              return {
                key: `map-loaded-${idx}-${Math.random().toString(16).slice(2)}`,
                value: headerName,
                renameHeader,
                selected: headerValueType,
                defaultValue,
                round: round || undefined,
                locked: SYSTEM_HEADERS.includes(headerName),
              }
            })
            .filter(Boolean)

          const effectiveRows = mappedRows.length ? mappedRows : [...SYSTEM_HEADERS.map(createSystemRow), createRow()]
          if (mounted) setRows(effectiveRows)

          const apiDefaultFirstRow =
            payload?.defaultFirstRow && typeof payload.defaultFirstRow === 'object' && !Array.isArray(payload.defaultFirstRow)
              ? payload.defaultFirstRow
              : null
          if (apiDefaultFirstRow && mounted) {
            const loadedHorizontalRow = { key: `h-loaded-${Date.now()}-${Math.random().toString(16).slice(2)}` }
            for (const rowDef of effectiveRows) {
              const headerName = String(rowDef?.value || '').trim()
              if (!headerName) continue
              const renamed = String(rowDef?.renameHeader || '').trim()
              const columnName = renamed || headerName
              const picked =
                apiDefaultFirstRow[columnName] != null ? apiDefaultFirstRow[columnName] : apiDefaultFirstRow[headerName]
              loadedHorizontalRow[headerName] = picked == null ? '' : String(picked)
            }
            setHorizontalRows([loadedHorizontalRow])
          }
        }

        if (mounted) setFormatMode('update')
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Failed to load JV DBK format')
      } finally {
        if (mounted) setLoadingFormat(false)
      }
    }

    fetchFormat()
    return () => {
      mounted = false
    }
  }, [BACKEND_URL])

  const handleSaveFormat = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }

    const postingAccountRows = postingAccounts
      .map((r) => ({
        POSTING_KEY: String(r.postingKey || '').trim(),
        ACCOUNT_NO: String(r.accountNo || '').trim(),
      }))
      .filter((r) => r.POSTING_KEY || r.ACCOUNT_NO)

    if (!postingAccountRows.length) {
      message.error('Add at least one POSTING_KEY and ACCOUNT_NO row.')
      return
    }

    const headerMappings = rows
      .map((r) => {
        const headerName = String(r.value || '').trim()
        const isPredefined = SYSTEM_HEADERS.includes(headerName)
        const headerValueType = isPredefined ? 'auto-added' : String(r.selected || '').trim()
        const renameHeader = String(r.renameHeader || '').trim()
        const round = String(r.round || '').trim()
        const out = { headerName, headerValueType, renameHeader, round }
        if (!isPredefined) {
          out.defaultValue = r.selected === 'default_value' ? String(r.defaultValue || '').trim() : ''
        }
        return out
      })
      .filter((r) => r.headerName && r.headerValueType)
      .map((r, idx) => ({ ...r, seq: idx + 1 }))

    if (!headerMappings.length) {
      message.error('Add at least one valid header mapping row.')
      return
    }

    const firstHorizontalRow = horizontalRows?.[0] && typeof horizontalRows[0] === 'object' ? horizontalRows[0] : {}
    const defaultFirstRow = {}
    for (const m of headerMappings) {
      const headerName = String(m.headerName || '').trim()
      if (!headerName) continue
      const columnName = String(m.renameHeader || '').trim() || headerName
      let value = firstHorizontalRow[headerName]
      if (value == null || value === '') {
        if (m.headerValueType === 'default_value') {
          value = m.defaultValue ?? ''
        } else if (m.headerValueType === 'current_date') {
          value = new Date().toLocaleDateString()
        } else {
          value = ''
        }
      }
      defaultFirstRow[columnName] = value
    }

    const body = {
      postingAccounts: postingAccountRows,
      headerMappings,
      defaultFirstRow,
    }

    setSubmitting(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/jv/create-jv-dbk-format`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Save JV DBK format failed (${res.status})`)
      }
      setFormatMode('update')
      message.success(data?.message || 'JV DBK format saved successfully')
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save JV DBK format')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                JV DBK Format
              </Title>
              <Text type="secondary">Configure posting/account fields and row-level value/dropdown mapping.</Text>
              <br />
              <Text type="secondary">
                System headers are auto-added and locked: {SYSTEM_HEADERS.join(', ')}
              </Text>
            </div>

            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Title level={5} style={{ margin: 0 }}>
                  Posting / Account
                </Title>
                <Button
                  icon={<PlusOutlined />}
                  onClick={() =>
                    setPostingAccounts((prev) => [
                      ...prev,
                      {
                        key: `pa-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                        postingKey: '',
                        accountNo: '',
                      },
                    ])
                  }
                >
                  Add Rows
                </Button>
              </Space>

              <Table
                rowKey="key"
                columns={postingColumns}
                dataSource={postingAccounts}
                pagination={false}
                scroll={{ x: 680 }}
                size="small"
              />
            </Space>

            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Title level={5} style={{ margin: 0 }}>
                  Rows
                </Title>
                <Button icon={<PlusOutlined />} onClick={() => setRows((prev) => [...prev, createRow()])}>
                  Add row
                </Button>
              </Space>

              <Table
                rowKey="key"
                columns={columns}
                dataSource={rows}
                pagination={false}
                scroll={{ x: 1100 }}
                size="small"
                onRow={getMappingTableRowProps}
              />
            </Space>

            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Title level={5} style={{ margin: 0 }}>
                  Horizontal Header Table
                </Title>
                <Space>
                  <Button icon={<PlusOutlined />} onClick={insertHorizontalDefaultRow}>
                    Insert default row
                  </Button>
                  <Button icon={<PlusOutlined />} onClick={addHorizontalRow}>
                    Add row
                  </Button>
                </Space>
              </Space>

              <Table
                rowKey="key"
                columns={horizontalHeaderColumns}
                dataSource={horizontalRows}
                pagination={false}
                scroll={{ x: 'max-content' }}
                size="small"
              />
            </Space>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="primary" onClick={handleSaveFormat} loading={submitting || loadingFormat}>
                {formatMode === 'update' ? 'Update JV DBK Format' : 'Create JV DBK Format'}
              </Button>
            </div>
          </Space>
        </AppShell>
  )
}
