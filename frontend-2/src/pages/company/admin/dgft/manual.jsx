import { Button, Input, Layout, Select, Space, Table, Typography, message } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography

function newInputRow() {
  return {
    key: `row-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    port: '',
    sbNumber: '',
    sbDate: '',
  }
}

const FETCH_USING_OPTIONS = [
  { value: 'dricat', label: 'dricat' },
  { value: 'selenium', label: 'selenium' },
]

function normalizeFetchUsing(value) {
  const v = String(value || '').trim().toLowerCase()
  if (v === 'dricat') return v
  return 'dricat'
}

export default function CompanyAdminDgftManualPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [inputs, setInputs] = useState([
    {
      key: 'default-1',
      port: 'INNSA1',
      sbNumber: '6438486',
      sbDate: '30/12/2023',
    },
  ])
  const [submitting, setSubmitting] = useState(false)
  const [lastResponse, setLastResponse] = useState(null)
  const [fetchUsing, setFetchUsing] = useState('selenium')

  const canSubmit = useMemo(() => {
    const hasRows = inputs.some(
      (r) => String(r.port || '').trim() && String(r.sbNumber || '').trim() && String(r.sbDate || '').trim(),
    )
    return Boolean(BACKEND_URL && hasRows)
  }, [BACKEND_URL, inputs])

  const tableData = useMemo(() => inputs, [inputs])

  const columns = [
    {
      title: 'Port',
      dataIndex: 'port',
      key: 'port',
      render: (_, record) => (
        <Input
          value={record.port}
          placeholder="INNSA1"
          onChange={(e) =>
            setInputs((prev) =>
              prev.map((row) => (row.key === record.key ? { ...row, port: e.target.value } : row)),
            )
          }
        />
      ),
    },
    {
      title: 'SB Number',
      dataIndex: 'sbNumber',
      key: 'sbNumber',
      render: (_, record) => (
        <Input
          value={record.sbNumber}
          placeholder="9107695"
          onChange={(e) =>
            setInputs((prev) =>
              prev.map((row) => (row.key === record.key ? { ...row, sbNumber: e.target.value } : row)),
            )
          }
        />
      ),
    },
    {
      title: 'SB Date',
      dataIndex: 'sbDate',
      key: 'sbDate',
      render: (_, record) => (
        <Input
          value={record.sbDate}
          placeholder="04-MAR-26"
          onChange={(e) =>
            setInputs((prev) =>
              prev.map((row) => (row.key === record.key ? { ...row, sbDate: e.target.value } : row)),
            )
          }
        />
      ),
    },
    {
      title: 'Action',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Button
          danger
          type="text"
          icon={<MinusCircleOutlined />}
          disabled={inputs.length <= 1}
          onClick={() => setInputs((prev) => prev.filter((row) => row.key !== record.key))}
        >
          Remove
        </Button>
      ),
    },
  ]

  const handleSubmit = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }

    const preparedInputs = inputs
      .map((r) => ({
        port: String(r.port || '').trim(),
        sbNumber: String(r.sbNumber || '').trim(),
        sbDate: String(r.sbDate || '').trim(),
      }))
      .filter((r) => r.port && r.sbNumber && r.sbDate)

    if (!preparedInputs.length) {
      message.error('Please add at least one valid input row.')
      return
    }

    const body = { inputs: preparedInputs, fetchUsing: normalizeFetchUsing(fetchUsing) }

    setSubmitting(true)
    setLastResponse(null)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/dgft/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Request failed (${res.status})`)
      }

      setLastResponse(data)
      message.success('DGFT process request submitted successfully.')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to submit DGFT process request')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                DGFT Manual Process
              </Title>
              <Text type="secondary">
                Submit port, SB number, and SB date for each row. The server uses configured DGFT credentials.
              </Text>
            </div>

            <Space wrap>
              <Space align="center" size={8}>
                <Text type="secondary">Fetch using:</Text>
                <Select
                  value={fetchUsing}
                  onChange={setFetchUsing}
                  options={FETCH_USING_OPTIONS}
                  style={{ width: 180 }}
                  disabled={submitting}
                />
              </Space>
              <Button
                icon={<PlusOutlined />}
                onClick={() => setInputs((prev) => [...prev, newInputRow()])}
              >
                Add Input Row
              </Button>
              <Button type="primary" loading={submitting} disabled={!canSubmit} onClick={handleSubmit}>
                Start DGFT Process
              </Button>
            </Space>

            <div style={{ minWidth: 0, maxWidth: '100%', overflowX: 'auto' }}>
              <Table
                rowKey="key"
                dataSource={tableData}
                columns={columns}
                pagination={false}
                scroll={{ x: 900 }}
              />
            </div>

            <div>
              <Text strong>Request body preview</Text>
              <pre
                style={{
                  marginTop: 8,
                  background: '#fafafa',
                  border: '1px solid #f0f0f0',
                  borderRadius: 8,
                  padding: 12,
                  overflowX: 'auto',
                  wordBreak: 'break-word',
                }}
              >
                {JSON.stringify(
                  {
                    inputs: inputs
                      .map((r) => ({
                        port: String(r.port || '').trim(),
                        sbNumber: String(r.sbNumber || '').trim(),
                        sbDate: String(r.sbDate || '').trim(),
                      }))
                      .filter((r) => r.port || r.sbNumber || r.sbDate),
                    fetchUsing: normalizeFetchUsing(fetchUsing),
                  },
                  null,
                  2,
                )}
              </pre>
            </div>

            {lastResponse ? (
              <div>
                <Text strong>Response</Text>
                <pre
                  style={{
                    marginTop: 8,
                    background: '#fafafa',
                    border: '1px solid #f0f0f0',
                    borderRadius: 8,
                    padding: 12,
                    overflowX: 'auto',
                    wordBreak: 'break-word',
                  }}
                >
                  {JSON.stringify(lastResponse, null, 2)}
                </pre>
              </div>
            ) : null}
          </Space>
        </AppShell>
  )
}

