import React, { useState, useCallback } from 'react'
import { Button, Form, Input, notification, Dropdown } from 'antd'
import { Plus, Building2, MoreHorizontal } from 'lucide-react'
import SiteAdminSidebar from '../../components/siteadmin/sidebar.jsx'
import AppShell from '../../components/layout/AppShell.jsx'
import PageHeader from '../../components/common/PageHeader.jsx'
import ProDataTable from '../../components/shared/ProDataTable.jsx'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL

export default function SiteAdminCompanyPage() {
  const [form] = Form.useForm()
  const [currentView, setCurrentView] = useState('list')
  const [detailCompany, setDetailCompany] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const fetchData = useCallback(async ({ page = 1, limit = 15, search }) => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      })
      if (search) params.append('search', search)

      const res = await fetch(`${BACKEND_URL}/api/siteadmin/company/?${params}`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json()
      
      if (res.ok) {
        const list = data.companies ?? (Array.isArray(data) ? data : data?.data ?? [])
        let total = list.length
        if (data.pagination && typeof data.pagination === 'object') {
          total = data.pagination.total ?? list.length
        }
        return { data: list, meta: { total } }
      }
      return { data: [], meta: { total: 0 } }
    } catch (err) {
      notification.error({ message: 'Failed to fetch companies' })
      return { data: [], meta: { total: 0 } }
    }
  }, [])

  const handleCreateCompany = async (values) => {
    setSubmitting(true)
    try {
      const payload = {
        name: values.name.trim(),
        username: values.username.trim(),
        email: values.email.trim(),
      }

      const response = await fetch(`${BACKEND_URL}/api/siteadmin/company/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data?.message || 'Failed to create company')
      }

      notification.success({ message: 'Company created successfully' })
      setCurrentView('list')
      form.resetFields()
      setRefreshKey(prev => prev + 1)
    } catch (err) {
      notification.error({ message: err instanceof Error ? err.message : 'Failed to create company' })
    } finally {
      setSubmitting(false)
    }
  }

  const columns = [
    { 
      title: 'Company Name', 
      dataIndex: 'name', 
      key: 'name',
      render: (val, r) => val || r.companyName || '-'
    },
    { 
      title: 'Admin Name', 
      key: 'adminName',
      render: (_, r) => r.adminUser?.name ?? '—'
    },
    { 
      title: 'Admin Email', 
      key: 'adminEmail',
      render: (_, r) => r.adminUser?.email ?? '—'
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_, r) => {
        const menuItems = [
          {
            key: 'view',
            label: 'View Details',
            onClick: () => {
              setDetailCompany(r)
              setCurrentView('view')
            }
          }
        ]

        return (
          <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
            <Button 
              type="text" 
              icon={<MoreHorizontal size={16} />} 
              className="text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md flex items-center justify-center w-8 h-8"
            />
          </Dropdown>
        )
      }
    }
  ]

  return (
    <AppShell sidebar={<SiteAdminSidebar />} portalType="siteadmin">
      <PageHeader
        title={
          currentView === 'create' ? 'Create Company' :
          currentView === 'view' ? 'Company Details' :
          'Companies'
        }
        description={
          currentView === 'create' ? 'Register a new company account' :
          currentView === 'view' ? 'Detailed information about this company' :
          'Manage all company accounts across the platform.'
        }
        actions={
          currentView === 'list' ? null : (
            <Button onClick={() => setCurrentView('list')} className="font-medium h-9 rounded-md">
              Back to List
            </Button>
          )
        }
      />

      <div className="flex-1 flex flex-col min-h-0">
        {currentView === 'list' ? (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white border border-slate-200 rounded-lg">
            <ProDataTable
              columns={columns}
              fetchData={fetchData}
              refreshKey={refreshKey}
              rowKey={(r) => r.id || r._id || Math.random().toString()}
              pagination={{ pageSize: 15 }}
              customToolbarActions={
                <Button 
                  type="primary" 
                  onClick={() => setCurrentView('create')} 
                  className="font-semibold flex items-center gap-2 h-9 rounded-md bg-blue-600 hover:bg-blue-700 border-none shadow-none"
                >
                  <Plus size={16} /> Add Company
                </Button>
              }
            />
          </div>
        ) : currentView === 'create' ? (
          <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-lg p-8 overflow-y-auto">
            <Form
              form={form}
              layout="vertical"
              onFinish={handleCreateCompany}
              autoComplete="off"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Form.Item
                  label={<span className="font-medium text-slate-700">Company Name</span>}
                  name="name"
                  rules={[{ required: true, whitespace: true, message: 'Please enter company name' }]}
                >
                  <Input placeholder="Enter company name" className="rounded-md h-10 border-slate-200" />
                </Form.Item>

                <Form.Item
                  label={<span className="font-medium text-slate-700">User Name</span>}
                  name="username"
                  rules={[{ required: true, whitespace: true, message: 'Please enter user name' }]}
                >
                  <Input placeholder="Enter user name" className="rounded-md h-10 border-slate-200" />
                </Form.Item>

                <Form.Item
                  label={<span className="font-medium text-slate-700">Admin Email</span>}
                  name="email"
                  rules={[
                    { required: true, whitespace: true, message: 'Please enter email' },
                    { type: 'email', message: 'Please enter a valid email' },
                  ]}
                >
                  <Input placeholder="Enter email address" className="rounded-md h-10 border-slate-200" />
                </Form.Item>
              </div>

              <div className="pt-6 flex justify-end border-t border-slate-100 mt-2">
                <Button 
                  type="primary" 
                  htmlType="submit" 
                  loading={submitting} 
                  className="font-semibold h-10 px-6 rounded-md bg-blue-600 hover:bg-blue-700 border-none shadow-none"
                >
                  Create Company
                </Button>
              </div>
            </Form>
          </div>
        ) : currentView === 'view' && detailCompany ? (
          <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-lg p-8 overflow-y-auto">
            <div className="space-y-6 max-w-4xl">
              <div className="flex items-center gap-4 border-b border-slate-200 pb-4">
                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center shrink-0">
                  <Building2 size={24} />
                </div>
                <div>
                  <div className="text-lg font-bold text-slate-900 leading-tight">
                    {detailCompany.name || detailCompany.companyName || '—'}
                  </div>
                  <div className="text-sm text-slate-500 mt-0.5">
                    ID: {detailCompany.id || detailCompany._id}
                  </div>
                </div>
              </div>

              {detailCompany.adminUser && (
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      Admin Name
                    </div>
                    <div className="text-sm font-medium text-slate-800">
                      {detailCompany.adminUser.name ?? '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      Admin Email
                    </div>
                    <div className="text-sm font-medium text-slate-800">
                      {detailCompany.adminUser.email ?? '—'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  )
}
