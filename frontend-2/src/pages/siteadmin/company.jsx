import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Layout,
  List,
  Modal,
  Pagination,
  Space,
  Typography,
  message,
} from 'antd'
import SiteAdminSidebar from '../../components/siteadmin/sidebar.jsx'
import AppShell from '../../components/layout/AppShell.jsx'

const { Content } = Layout
const { Title, Text } = Typography
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL

export default function SiteAdminCompanyPage() {
  const [form] = Form.useForm()
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [error, setError] = useState('')
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  })
  const [detailCompany, setDetailCompany] = useState(null)

  const fetchCompanies = async (page = 1, limit = 10) => {
    setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      })
      const response = await fetch(`${BACKEND_URL}/api/siteadmin/company/?${params}`, {
        method: 'GET',
        credentials: 'include',
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data?.message || 'Failed to fetch company list')
      }

      const list =
        data.companies ?? (Array.isArray(data) ? data : data?.data ?? [])
      setCompanies(list)

      if (data.pagination && typeof data.pagination === 'object') {
        setPagination({
          page: data.pagination.page ?? page,
          limit: data.pagination.limit ?? limit,
          total: data.pagination.total ?? list.length,
          totalPages: data.pagination.totalPages ?? 1,
        })
      } else {
        setPagination((prev) => ({
          ...prev,
          page,
          limit,
          total: list.length,
          totalPages: Math.max(1, Math.ceil(list.length / limit)),
        }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch company list')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCompanies(1, pagination.limit)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, [])

  const handleCreateCompany = async (values) => {
    setCreating(true)
    setError('')

    try {
      const payload = {
        name: values.name.trim(),
        username: values.username.trim(),
        email: values.email.trim(),
      }

      const response = await fetch(`${BACKEND_URL}/api/siteadmin/company/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data?.message || 'Failed to create company')
      }

      message.success('Company created successfully')
      setCreateModalOpen(false)
      form.resetFields()
      fetchCompanies(pagination.page, pagination.limit)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create company')
    } finally {
      setCreating(false)
    }
  }

  return (
    <AppShell sidebar={<SiteAdminSidebar />} portalType="siteadmin">
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <Title level={3} style={{ margin: 0 }}>
                  Company
                </Title>
                <Text type="secondary">Create and view all companies.</Text>
              </div>
              <Button type="primary" onClick={() => setCreateModalOpen(true)}>
                Create Company
              </Button>
            </div>

            {error ? <Alert type="error" message={error} showIcon /> : null}

            <Modal
              title="Create Company"
              open={createModalOpen}
              onCancel={() => {
                setCreateModalOpen(false)
                setError('')
                form.resetFields()
              }}
              footer={null}
              destroyOnClose
            >
              <Form
                form={form}
                layout="vertical"
                onFinish={handleCreateCompany}
                autoComplete="off"
              >
                <Form.Item
                  label="Company Name"
                  name="name"
                  rules={[{ required: true, whitespace: true, message: 'Please enter company name' }]}
                >
                  <Input placeholder="Enter company name" />
                </Form.Item>

                <Form.Item
                  label="User Name"
                  name="username"
                  rules={[{ required: true, whitespace: true, message: 'Please enter user name' }]}
                >
                  <Input placeholder="Enter user name" />
                </Form.Item>

                <Form.Item
                  label="Email"
                  name="email"
                  rules={[
                    { required: true, whitespace: true, message: 'Please enter email' },
                    { type: 'email', message: 'Please enter a valid email' },
                  ]}
                >
                  <Input placeholder="Enter email" />
                </Form.Item>

                <Button type="primary" htmlType="submit" loading={creating} block>
                  Create
                </Button>
              </Form>
            </Modal>

            <Card
              title="Company List"
              extra={
                <Button onClick={() => fetchCompanies(pagination.page, pagination.limit)}>
                  Refresh
                </Button>
              }
            >
              <List
                bordered
                loading={loading}
                dataSource={companies}
                locale={{ emptyText: 'No companies found' }}
                renderItem={(item) => {
                  const companyName = item?.name || item?.companyName || '-'
                  const admin = item?.adminUser
                  const adminName = admin?.name ?? '—'
                  const adminEmail = admin?.email ?? '—'

                  return (
                    <List.Item
                      actions={[
                        <Button type="primary" key="view" onClick={() => setDetailCompany(item)}>
                          View
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={<Text strong>{companyName}</Text>}
                        description={
                          <Space direction="vertical" size={2}>
                            <Text type="secondary">
                              Admin: {adminName}
                            </Text>
                            <Text type="secondary">{adminEmail}</Text>
                          </Space>
                        }
                      />
                    </List.Item>
                  )
                }}
              />
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <Pagination
                  current={pagination.page}
                  pageSize={pagination.limit}
                  total={pagination.total}
                  showSizeChanger
                  pageSizeOptions={[10, 20, 50]}
                  showTotal={(total, range) =>
                    `${range[0]}-${range[1]} of ${total} companies`
                  }
                  onChange={(page, pageSize) => {
                    fetchCompanies(page, pageSize)
                  }}
                />
              </div>
            </Card>

            <Modal
              title="Company details"
              open={!!detailCompany}
              onCancel={() => setDetailCompany(null)}
              footer={[
                <Button key="close" type="primary" onClick={() => setDetailCompany(null)}>
                  Close
                </Button>,
              ]}
              destroyOnClose
            >
              {detailCompany ? (
                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                  <div>
                    <Text type="secondary">Company name</Text>
                    <div>
                      <Text strong>
                        {detailCompany.name || detailCompany.companyName || '—'}
                      </Text>
                    </div>
                  </div>
                  {detailCompany.id || detailCompany._id ? (
                    <div>
                      <Text type="secondary">Company ID</Text>
                      <div>
                        <Text>{detailCompany.id || detailCompany._id}</Text>
                      </div>
                    </div>
                  ) : null}
                  {detailCompany.adminUser ? (
                    <>
                      <div>
                        <Text type="secondary">Admin name</Text>
                        <div>
                          <Text strong>{detailCompany.adminUser.name ?? '—'}</Text>
                        </div>
                      </div>
                      <div>
                        <Text type="secondary">Admin email</Text>
                        <div>
                          <Text>{detailCompany.adminUser.email ?? '—'}</Text>
                        </div>
                      </div>
                    </>
                  ) : null}
                </Space>
              ) : null}
            </Modal>
          </Space>
    </AppShell>
  )
}
