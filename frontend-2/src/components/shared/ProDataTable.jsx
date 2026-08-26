import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Table,
  Input,
  Button,
  Select,
  Popover,
  Checkbox,
  Tooltip,
  Space,
  Typography,
  Skeleton,
  Pagination
} from 'antd'
import {
  SearchOutlined,
  DownloadOutlined,
  SettingOutlined,
  PlusOutlined,
  UploadOutlined,
  FileTextOutlined,
  FilterOutlined,
  CalendarOutlined,
  CloseOutlined,
  LeftOutlined,
  RightOutlined,
  DownOutlined,
} from '@ant-design/icons'
import './ProDataTable.css'

const { Text } = Typography

/**
 * Utility to resolve nested object paths
 */
const resolvePath = (obj, path) => {
  if (!path) return ''
  return path.split('.').reduce((prev, curr) => (prev ? prev[curr] : ''), obj) || ''
}

/**
 * MultiSelectFilter - Compact inline select for headers
 */
const MultiSelectFilter = ({ options, value, onChange, placeholder }) => {
  const selectedValues = Array.isArray(value) ? value : (value ? [value] : [])
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const filteredOptions = options.filter(opt =>
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const toggleOption = (val) => {
    const newVal = selectedValues.includes(val)
      ? selectedValues.filter(v => v !== val)
      : [...selectedValues, val]
    onChange(newVal)
  }

  const clearFilters = (e) => {
    e.stopPropagation()
    onChange([])
    setSearchTerm('')
  }

  const content = (
    <div style={{ width: 180, display: 'flex', flexDirection: 'column', maxHeight: 250 }}>
      <div style={{ padding: 8, borderBottom: '1px solid var(--exim-border-light)' }}>
        <Input
          prefix={<SearchOutlined style={{ color: 'var(--exim-gray-400)' }} />}
          placeholder="Search..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          size="small"
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 4 }} className="custom-scrollbar">
        {filteredOptions.map((opt) => (
          <div
            key={opt.value}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 8px',
              cursor: 'pointer',
              borderRadius: 4,
            }}
            className="multiselect-item"
            onClick={() => toggleOption(opt.value)}
          >
            <Checkbox checked={selectedValues.includes(opt.value)} />
            <span style={{ fontSize: 12, color: 'var(--exim-gray-700)' }}>{opt.label}</span>
          </div>
        ))}
      </div>
      {selectedValues.length > 0 && (
        <div style={{ padding: 6, borderTop: '1px solid var(--exim-border-light)', background: 'var(--exim-gray-50)' }}>
          <Button
            type="text"
            size="small"
            block
            onClick={clearFilters}
            style={{ fontSize: 10, color: 'var(--exim-error)' }}
          >
            Clear All
          </Button>
        </div>
      )}
    </div>
  )

  return (
    <Popover open={open} onOpenChange={setOpen} content={content} trigger="click" placement="bottomLeft" overlayInnerStyle={{ padding: 0 }}>
      <Button
        size="small"
        style={{
          height: 28,
          fontSize: 10,
          width: '100%',
          minWidth: 90,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
          {selectedValues.length === 0 ? (
            <span style={{ color: 'var(--exim-gray-400)', textTransform: 'capitalize' }}>{placeholder}</span>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontWeight: 'bold', color: 'var(--exim-primary)', background: 'var(--exim-primary-50)', padding: '0 4px', borderRadius: 2 }}>
                {selectedValues.length}
              </span>
              <span style={{ textTransform: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {options.find(o => o.value === selectedValues[0])?.label}
              </span>
              {selectedValues.length > 1 && <span style={{ color: 'var(--exim-gray-400)' }}>...</span>}
            </div>
          )}
        </div>
        <DownOutlined style={{ fontSize: 10, opacity: 0.5 }} />
      </Button>
    </Popover>
  )
}

/**
 * TableSettings - Gear menu for sticky column management
 */
const TableSettings = ({ columns, stickyColumns, setStickyColumns }) => {
  const [open, setOpen] = useState(false)

  const toggleSticky = (colId) => {
    setStickyColumns(prev => {
      if (prev.includes(colId)) return prev.filter(id => id !== colId)
      if (prev.length >= 3) return prev
      return [...prev, colId]
    })
  }

  const content = (
    <div style={{ width: 224, padding: 0 }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--exim-border-light)', background: 'var(--exim-gray-50)' }}>
        <h4 style={{ fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--exim-gray-500)', margin: 0 }}>Table Settings</h4>
      </div>
      <div style={{ maxHeight: 300, overflowY: 'auto', padding: 4 }} className="custom-scrollbar">
        <p style={{ padding: '6px 8px', fontSize: 10, fontWeight: 600, color: 'var(--exim-gray-400)', textTransform: 'uppercase', margin: 0 }}>Sticky Columns</p>
        <div style={{ paddingBottom: 4 }}>
          {columns.map(col => {
            const id = col.id || col.key || col.dataIndex
            if (!id) return null
            return (
              <div
                key={id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', borderRadius: 4 }}
                className="hover-bg-slate-50"
                onClick={() => toggleSticky(id)}
              >
                <Checkbox checked={stickyColumns.includes(id)} />
                <span style={{ fontSize: 12, color: 'var(--exim-gray-700)' }}>{col.title || col.header}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  return (
    <Popover open={open} onOpenChange={setOpen} content={content} trigger="click" placement="bottomRight" overlayInnerStyle={{ padding: 0 }}>
      <Button icon={<SettingOutlined />} style={{ color: 'var(--exim-gray-600)', borderColor: 'var(--exim-border)' }} />
    </Popover>
  )
}

/**
 * Custom Header Component to handle inline filtering
 */
const CustomHeaderCell = ({ col, columnId, columnFilters, onFilterChange, activeHeaderFilters, toggleHeaderFilter, lockActiveFilters }) => {
  const hasFilter = Array.isArray(columnFilters[columnId])
    ? columnFilters[columnId].length > 0
    : !!(columnFilters[columnId])
    
  const isFilterOpen = activeHeaderFilters.has(columnId) || (lockActiveFilters && hasFilter)

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, height: '100%', padding: '4px 0' }}>
      {!isFilterOpen ? (
        <>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.title || col.header}</span>
          {col.filterType && (
            <Button
              type="text"
              size="small"
              onClick={() => toggleHeaderFilter(columnId)}
              style={{
                height: 24,
                width: 24,
                padding: 0,
                color: hasFilter ? 'var(--exim-primary)' : 'var(--exim-gray-400)',
                background: hasFilter ? 'var(--exim-primary-50)' : 'transparent',
              }}
              icon={col.filterType === 'select' ? <FilterOutlined /> : col.filterType === 'date' ? <CalendarOutlined /> : <SearchOutlined />}
            />
          )}
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', animation: 'fadeIn 0.2s' }}>
          {col.filterType === 'select' ? (
            col.isMulti ? (
              <MultiSelectFilter
                options={col.filterOptions || []}
                value={columnFilters[columnId]}
                onChange={(val) => onFilterChange({ [columnId]: val })}
                placeholder={col.title || col.header}
              />
            ) : (
              <Select
                size="small"
                value={columnFilters[columnId] || 'all'}
                onChange={(val) => onFilterChange({ [columnId]: val === 'all' ? '' : val })}
                style={{ flex: 1, fontSize: 10, height: 28 }}
              >
                <Select.Option value="all" style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--exim-gray-400)' }}>All {col.title || col.header}</Select.Option>
                {col.filterOptions?.map((opt, i) => (
                  <Select.Option key={`${opt.value}-${i}`} value={opt.value.toString()} style={{ fontSize: 12 }}>{opt.label}</Select.Option>
                ))}
              </Select>
            )
          ) : col.filterType === 'date' ? (
            <Input
              type="date"
              autoFocus
              size="small"
              value={columnFilters[columnId] || ''}
              onChange={(e) => onFilterChange({ [columnId]: e.target.value })}
              style={{ flex: 1, fontSize: 10, height: 28 }}
            />
          ) : (
            <Input
              autoFocus
              size="small"
              placeholder={`Filter ${col.title || col.header}...`}
              value={columnFilters[columnId] || ''}
              onChange={(e) => onFilterChange({ [columnId]: e.target.value })}
              style={{ flex: 1, fontSize: 10, height: 28, textTransform: 'none', fontWeight: 'normal' }}
            />
          )}
          <Button
            type="text"
            size="small"
            onClick={() => {
              if (columnFilters[columnId]) onFilterChange({ [columnId]: '' })
              toggleHeaderFilter(columnId)
            }}
            style={{ height: 24, width: 24, padding: 0, color: 'var(--exim-gray-400)' }}
            className="hover-bg-red-50 hover-text-red-500"
            icon={<CloseOutlined style={{ fontSize: 10 }} />}
          />
        </div>
      )}
    </div>
  )
}


const DEFAULT_COLUMN_FILTERS = {}
const DEFAULT_TOP_FILTERS = []

const ProDataTable = ({
  columns,
  fetchData,
  onAdd,
  onExport,
  columnFilters = DEFAULT_COLUMN_FILTERS,
  onFilterChange = () => {},
  refreshKey = 0,
  topFilters = DEFAULT_TOP_FILTERS,
  globalSearchPlaceholder = "Search...",
  initialStickyColumns = [],
  onAddTooltip = "Add New",
  onImport,
  onDownloadTemplate,
  selectedRows: controlledSelectedRows,
  onSelectionChange,
  showSelectionColumn = true,
  lockActiveFilters = false,
  customToolbarActions,
  rowKey = 'id',
  expandable,
}) => {
  const [data, setData] = useState([])
  const [meta, setMeta] = useState({})
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    const saved = localStorage.getItem("table_page_size")
    return saved ? parseInt(saved) : 10
  })
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [internalSelectedRows, setInternalSelectedRows] = useState(new Set())
  const [stickyColumns, setStickyColumns] = useState(initialStickyColumns)
  const [activeHeaderFilters, setActiveHeaderFilters] = useState(new Set())

  const selectedRows = controlledSelectedRows || internalSelectedRows
  const isControlledSelection = !!onSelectionChange

  const isFirstRender = useRef(true)

  // Debounce global search
  useEffect(() => {
    if (isFirstRender.current) return
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 500)
    return () => clearTimeout(timer)
  }, [search])

  // Sync Data
  useEffect(() => {
    let cancelled = false
    const loadData = async () => {
      if (!fetchData) return
      setLoading(true)
      try {
        const result = await fetchData({
          page,
          limit: pageSize,
          search: debouncedSearch,
          columnFilters
        })
        if (!cancelled) {
          setData(result?.data || [])
          setMeta(result?.meta || {})
        }
      } catch (error) {
        console.error("ProDataTable sync error:", error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadData()
    return () => { cancelled = true }
  }, [page, pageSize, debouncedSearch, columnFilters, fetchData, refreshKey])

  useEffect(() => {
    if (isFirstRender.current) isFirstRender.current = false
  }, [])

  useEffect(() => {
    localStorage.setItem("table_page_size", pageSize.toString())
  }, [pageSize])

  const toggleHeaderFilter = (columnId) => {
    setActiveHeaderFilters(prev => {
      const next = new Set(prev)
      if (next.has(columnId)) next.delete(columnId)
      else next.add(columnId)
      return next
    })
  }

  // Inject Custom Headers & Sticky logic
  const processedColumns = useMemo(() => {
    return columns.map((col) => {
      const colId = col.id || col.key || col.dataIndex
      const isSticky = stickyColumns.includes(colId)
      
      const customTitle = (
        <CustomHeaderCell
          col={col}
          columnId={colId}
          columnFilters={columnFilters}
          onFilterChange={onFilterChange}
          activeHeaderFilters={activeHeaderFilters}
          toggleHeaderFilter={toggleHeaderFilter}
          lockActiveFilters={lockActiveFilters}
        />
      )

      return {
        ...col,
        title: customTitle,
        fixed: isSticky ? 'left' : undefined,
        render: (value, record, index) => {
          if (col.cell) return col.cell(record, index)
          if (col.render) return col.render(value, record, index)
          return resolvePath(record, col.dataIndex || col.key)
        },
        onCell: (record) => {
          const isSelected = selectedRows.has(typeof rowKey === 'function' ? rowKey(record) : record[rowKey])
          return {
            className: isSelected ? 'selected-cell' : '',
          }
        }
      }
    })
  }, [columns, stickyColumns, columnFilters, activeHeaderFilters, lockActiveFilters, selectedRows, onFilterChange, rowKey])

  // Data
  const tableData = data

  const rowSelection = showSelectionColumn ? {
    selectedRowKeys: Array.isArray(selectedRows) ? selectedRows : Array.from(selectedRows),
    onChange: (selectedKeys) => {
      if (isControlledSelection) {
        onSelectionChange(new Set(selectedKeys))
      } else {
        setInternalSelectedRows(new Set(selectedKeys))
      }
    },
    getCheckboxProps: (record) => ({
      disabled: false,
    }),
  } : undefined

  const totalItems = meta.total || 0
  const totalPages = meta.totalPages || Math.ceil(totalItems / pageSize) || 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', background: '#fff', border: '1px solid var(--exim-border-light)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 16px', borderBottom: '1px solid var(--exim-border-light)' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <Input
            prefix={<SearchOutlined style={{ color: 'var(--exim-gray-400)' }} />}
            placeholder={globalSearchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ borderRadius: 6, height: 36, fontSize: 12 }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {customToolbarActions && (
            <div style={{ marginRight: 8, display: 'flex', alignItems: 'center' }}>
              {customToolbarActions}
            </div>
          )}
          
          {topFilters.map((tf, i) => (
            <Select
              key={i}
              value={tf.value}
              onChange={tf.onChange}
              placeholder={tf.placeholder}
              options={tf.options}
              style={{ width: 140, height: 36 }}
            />
          ))}

          {onExport && (
            <Tooltip title="Export Data">
              <Button icon={<DownloadOutlined />} onClick={onExport} style={{ height: 36, width: 36, padding: 0 }} />
            </Tooltip>
          )}

          <TableSettings 
            columns={columns} 
            stickyColumns={stickyColumns} 
            setStickyColumns={setStickyColumns} 
          />

          {onAdd && (
            <Tooltip title={onAddTooltip}>
              <Button type="primary" icon={<PlusOutlined />} onClick={onAdd} style={{ height: 36, width: 36, padding: 0, background: 'var(--exim-gray-800)' }} />
            </Tooltip>
          )}

          {onDownloadTemplate && (
            <Tooltip title="Download Sample Template">
              <Button icon={<FileTextOutlined />} onClick={onDownloadTemplate} style={{ height: 36, width: 36, padding: 0 }} />
            </Tooltip>
          )}

          {onImport && (
            <Tooltip title="Bulk Import from Excel">
              <Button
                icon={<UploadOutlined />}
                onClick={() => {
                  const input = document.createElement('input')
                  input.type = 'file'
                  input.accept = '.xlsx, .xls'
                  input.onchange = (e) => onImport(e.target.files[0])
                  input.click()
                }}
                style={{ height: 36, width: 36, padding: 0, color: 'var(--exim-success)' }}
              />
            </Tooltip>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="pro-table-antd-container" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
        <Table
          rowKey={(record, index) => typeof rowKey === 'function' ? rowKey(record, index) : (record[rowKey] || index)}
          columns={processedColumns}
          dataSource={tableData}
          loading={loading}
          rowSelection={rowSelection}
          pagination={false}
          scroll={{ x: 'max-content', y: 'calc(100vh - 350px)' }}
          size="small"
          className="pro-table-antd"
          rowClassName={(record) => {
            const isSelected = selectedRows.has(typeof rowKey === 'function' ? rowKey(record) : record[rowKey])
            return isSelected ? 'pro-table-row-selected' : 'pro-table-row'
          }}
          locale={{ emptyText: <div style={{ height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--exim-gray-400)', fontWeight: 500 }}>No records found.</div> }}
          expandable={expandable}
        />

        {/* Pagination */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '10px 16px', borderTop: '1px solid var(--exim-border-light)', background: '#fff' }}>
          <Pagination
            size="small"
            current={meta.page || page}
            pageSize={pageSize}
            total={totalItems}
            showSizeChanger
            pageSizeOptions={['5', '10', '20', '50', '100']}
            showTotal={(total, range) => `${range[0]}-${range[1]} of ${total}`}
            onChange={(newPage, newPageSize) => {
              if (newPageSize !== pageSize) {
                setPageSize(newPageSize)
                setPage(1)
              } else {
                setPage(newPage)
              }
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default ProDataTable
