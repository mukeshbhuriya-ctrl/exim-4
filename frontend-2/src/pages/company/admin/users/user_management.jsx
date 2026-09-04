import React, { useState, useEffect } from 'react';
import { Space, Typography, Button, ConfigProvider, notification, Form, Input, Select, Modal, Switch, Popconfirm, Dropdown } from 'antd';
import { Plus, Save, UserPlus, Trash2, Edit2, MoreHorizontal } from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import CompanySidebar from '@/components/company/sidebar';
import ProDataTable from '@/components/shared/ProDataTable';
import { AccessControl } from '@/components/iam/AccessControl';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

import PageHeader from '@/components/common/PageHeader';

export default function UserManagement() {
  const [currentView, setCurrentView] = useState('list');
  const [roles, setRoles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingUser, setEditingUser] = useState(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchData = React.useCallback(async ({ page = 1, limit = 15, search }) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/users`, { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        let rows = data.users || [];
        if (search) {
          const lowerSearch = search.toLowerCase();
          rows = rows.filter(r => 
            (r.name && r.name.toLowerCase().includes(lowerSearch)) || 
            (r.email && r.email.toLowerCase().includes(lowerSearch))
          );
        }
        const startIndex = (page - 1) * limit;
        const paginatedRows = rows.slice(startIndex, startIndex + limit);
        return { data: paginatedRows, meta: { total: rows.length } };
      }
      return { data: [], meta: { total: 0 } };
    } catch (err) {
      notification.error({ message: 'Failed to fetch users' });
      return { data: [], meta: { total: 0 } };
    }
  }, []);

  const fetchRoles = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/roles`, { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setRoles(data.roles);
      }
    } catch (err) {
      // silent fail or log
    }
  };

  const handleCreateUser = async (values) => {
    setSubmitting(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(values)
      });
      const data = await res.json();
      
      if (data.success) {
        if (data.errors && data.errors.length > 0) {
          notification.warning({ 
            message: 'Completed with some errors',
            // description: `${data.createdUsers.length} users created. ${data.errors.length} failed. Check emails for duplicates.`
          });
        } else {
          notification.success({ 
            message: 'User Created Successfully',
            // description: 'All users have been added and their credentials have been emailed to them.'
          });
        }
        
        setCurrentView('list');
        form.resetFields();
        setRefreshKey(prev => prev + 1);
      } else {
        notification.error({ message: data.message || 'Failed to create users' });
      }
    } catch (err) {
      notification.error({ message: 'Error saving users' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (values) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(values)
      });
      const data = await res.json();
      if (data.success) {
        notification.success({ message: 'User updated successfully' });
        setEditingUser(null);
        setCurrentView('list');
        setRefreshKey(prev => prev + 1);
      } else {
        notification.error({ message: data.message || 'Failed to update user' });
      }
    } catch (err) {
      notification.error({ message: 'Error updating user' });
    }
  };

  const handleToggleActive = async (id, checked) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isActive: checked })
      });
      const data = await res.json();
      if (data.success) {
        notification.success({ message: 'User status updated' });
        setRefreshKey(prev => prev + 1);
      } else {
        notification.error({ message: data.message || 'Failed to update status' });
      }
    } catch (err) {
      notification.error({ message: 'Error updating user status' });
    }
  };

  const handleDeleteUser = async (id) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/users/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        notification.success({ message: 'User deleted successfully' });
        setRefreshKey(prev => prev + 1);
      } else {
        notification.error({ message: data.message || 'Failed to delete user' });
      }
    } catch (err) {
      notification.error({ message: 'Error deleting user' });
    }
  };

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name', width: 200 },
    { title: 'Email', dataIndex: 'email', key: 'email', width: 250 },
    { 
      title: 'Role', 
      key: 'role', 
      render: (_, r) => r.assignedRole ? r.assignedRole.businessName : 'Unassigned',
      width: 200
    },
    { 
      title: 'Status', 
      key: 'status', 
      render: (_, r) => (
        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${r.isActive ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
          {r.isActive ? 'Active' : 'Inactive'}
        </span>
      ),
      width: 150
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_, r) => {
        const menuItems = [
          {
            key: 'edit',
            label: 'Edit',
            onClick: () => {
              setEditingUser(r);
              editForm.setFieldsValue({
                name: r.name,
                email: r.email,
                roleId: r.assignedRole?._id
              });
              setCurrentView('edit');
            }
          },
          {
            key: 'toggleStatus',
            label: r.isActive ? 'Deactivate User' : 'Activate User',
            onClick: () => {
              Modal.confirm({
                title: r.isActive ? 'Deactivate User' : 'Activate User',
                content: `Are you sure you want to ${r.isActive ? 'deactivate' : 'activate'} ${r.name}?`,
                okText: 'Yes',
                okType: r.isActive ? 'danger' : 'primary',
                cancelText: 'No',
                onOk: () => handleToggleActive(r.id, !r.isActive)
              });
            }
          },
          {
            key: 'delete',
            label: <span className="text-red-600">Delete</span>,
            danger: true,
            onClick: () => {
              Modal.confirm({
                title: 'Delete User',
                content: `Are you sure you want to delete ${r.name}?`,
                okText: 'Yes',
                okType: 'danger',
                cancelText: 'No',
                onOk: () => handleDeleteUser(r.id)
              });
            }
          }
        ];

        return (
          <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
            <Button 
              type="text" 
              icon={<MoreHorizontal size={16} />} 
              className="text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md flex items-center justify-center w-8 h-8"
            />
          </Dropdown>
        );
      }
    }
  ];

  return (
    <>
      <AppShell sidebar={<CompanySidebar />}>
        <PageHeader
          title="User Management"
        description="Manage team members and their role assignments."
        actions={
          currentView === 'list' ? null : (
            <Button onClick={() => setCurrentView('list')} style={{ fontWeight: 500 }}>
              Back to List
            </Button>
          )
        }
      />
      <div style={{ padding: 0, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <ConfigProvider theme={{ components: { Table: { colorBgContainer: '#ffffff', borderRadius: 12 } } }}>
          {currentView === 'list' ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <ProDataTable
                columns={columns}
                fetchData={fetchData}
                refreshKey={refreshKey}
                rowKey="id"
                pagination={{ pageSize: 15 }}
                customToolbarActions={
                  <AccessControl required="admin:users:create">
                    <Button type="primary" onClick={() => setCurrentView('create')} style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, height: 36 }}>
                      <Plus size={16} /> Add New User
                    </Button>
                  </AccessControl>
                }
              />
            </div>
          ) : (
            <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    {currentView === 'create' ? 'Create New Users' : 'Edit User'}
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">
                    {currentView === 'create' 
                      ? 'Add one or more team members and assign their system roles. They will receive a welcome email with their credentials.'
                      : 'Update team member details and role assignments.'
                    }
                  </p>
                </div>
              </div>
              
              <div className="p-8 flex-1 overflow-y-auto">
                {currentView === 'create' ? (
                  <Form 
                    layout="vertical" 
                    form={form} 
                    onFinish={handleCreateUser}
                    requiredMark={false}
                    className="w-full"
                    initialValues={{ users: [{}] }}
                  >
                    <Form.List name="users">
                      {(fields, { add, remove }) => (
                        <div className="space-y-8">
                          {fields.map((field, index) => (
                            <div key={field.key} className="relative">
                              {index > 0 && <hr className="mb-8 border-t border-slate-100" />}
                              
                              <div className="flex items-center justify-between mb-6">
                                <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold">
                                    {index + 1}
                                  </span>
                                  User Credentials
                                </h4>
                                {fields.length > 1 && (
                                  <button 
                                    type="button" 
                                    onClick={() => remove(field.name)}
                                    className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-md transition-colors flex items-center justify-center"
                                    title="Remove User"
                                  >
                                    <Trash2 size={18} />
                                  </button>
                                )}
                              </div>
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                                <Form.Item 
                                  label={<span className="text-sm font-medium text-slate-700">Full Name <span className="text-red-500 ml-0.5">*</span></span>}
                                  name={[field.name, 'name']}
                                  rules={[{ required: true, message: 'Please enter the full name' }]}
                                  className="mb-0"
                                >
                                  <Input 
                                    required
                                    placeholder="e.g. John Doe" 
                                    className="h-10 rounded-md border-slate-200 hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all text-sm"
                                  />
                                </Form.Item>
                                
                                <Form.Item 
                                  label={<span className="text-sm font-medium text-slate-700">Email Address <span className="text-red-500 ml-0.5">*</span></span>}
                                  name={[field.name, 'email']}
                                  rules={[{ required: true, type: 'email', message: 'Valid email is required' }]}
                                  className="mb-0"
                                >
                                  <Input 
                                    required
                                    type="email"
                                    placeholder="user@company.com" 
                                    className="h-10 rounded-md border-slate-200 hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all text-sm"
                                  />
                                </Form.Item>
                                
                                <Form.Item 
                                  label={<span className="text-sm font-medium text-slate-700">Assign Role <span className="text-red-500 ml-0.5">*</span></span>}
                                  name={[field.name, 'roleId']}
                                  rules={[{ required: true, message: 'Please select a role' }]}
                                  className="mb-0"
                                >
                                  <Select 
                                    placeholder="Select a role..."
                                    className="h-10 w-full"
                                    popupClassName="rounded-lg shadow-lg border border-slate-100"
                                  >
                                    {roles.map(r => (
                                      <Select.Option key={r._id} value={r._id}>
                                        <div className="flex flex-col py-1">
                                          <div className="flex items-center justify-between">
                                            <span className="font-medium text-slate-700">{r.businessName}</span>
                                            {r.isSystemRole && <span className="text-[10px] uppercase tracking-wider bg-slate-100 text-slate-500 px-2 py-0.5 rounded">System</span>}
                                          </div>
                                          {r.description && <span className="text-xs text-slate-500 mt-0.5">{r.description}</span>}
                                        </div>
                                      </Select.Option>
                                    ))}
                                  </Select>
                                </Form.Item>
                              </div>
                            </div>
                          ))}
                          
                          <div className="pt-2">
                            <Button 
                              type="dashed" 
                              onClick={() => add()} 
                              icon={<Plus size={16} />}
                              className="h-10 px-4 font-medium text-blue-600 border-blue-200 hover:border-blue-400 hover:text-blue-700 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2 rounded-md"
                            >
                              Add Another User
                            </Button>
                          </div>
                        </div>
                      )}
                    </Form.List>
                    
                    <div className="pt-6 mt-8 border-t border-slate-100 flex items-center justify-end gap-3">
                      <Button 
                        type="default"
                        onClick={() => {
                          form.resetFields();
                          setCurrentView('list');
                        }}
                        className="h-11 px-6 font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 border-slate-200"
                      >
                        Cancel
                      </Button>
                      <Button 
                        type="primary" 
                        htmlType="submit"
                        loading={submitting} 
                        className="h-11 px-8 font-medium text-white bg-[#111827] hover:bg-[#1F2937] border-transparent shadow-sm flex items-center gap-2.5 rounded-md transition-colors"
                      >
                        <UserPlus size={18} />
                        Create
                      </Button>
                    </div>
                  </Form>
                ) : (
                  <Form 
                    form={editForm} 
                    layout="vertical" 
                    onFinish={handleEditSubmit}
                    requiredMark={false}
                    className="w-full"
                  >
                    <div className="space-y-8">
                      <div className="relative">
                        <div className="flex items-center justify-between mb-6">
                          <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold">
                              1
                            </span>
                            User Credentials
                          </h4>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                          <Form.Item 
                            label={<span className="text-sm font-medium text-slate-700">Full Name <span className="text-red-500 ml-0.5">*</span></span>}
                            name="name"
                            rules={[{ required: true, message: 'Please enter the full name' }]}
                            className="mb-0"
                          >
                            <Input 
                              placeholder="e.g. John Doe" 
                              className="h-10 rounded-md border-slate-200 hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all text-sm" 
                            />
                          </Form.Item>
                          
                          <Form.Item 
                            label={<span className="text-sm font-medium text-slate-700">Email Address</span>}
                            name="email"
                            className="mb-0"
                          >
                            <Input 
                              disabled
                              className="h-10 rounded-md border-slate-200 bg-slate-50 text-slate-500 cursor-not-allowed text-sm" 
                            />
                          </Form.Item>
                          
                          <Form.Item 
                            label={<span className="text-sm font-medium text-slate-700">Assign Role <span className="text-red-500 ml-0.5">*</span></span>}
                            name="roleId"
                            rules={[{ required: true, message: 'Please select a role' }]}
                            className="mb-0"
                          >
                            <Select 
                              placeholder="Select a role..."
                              className="h-10 w-full"
                              popupClassName="rounded-lg shadow-lg border border-slate-100"
                            >
                              {roles.map(r => (
                                <Select.Option key={r._id} value={r._id}>
                                  <div className="flex flex-col py-1">
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium text-slate-700">{r.businessName}</span>
                                      {r.isSystemRole && <span className="text-[10px] uppercase tracking-wider bg-slate-100 text-slate-500 px-2 py-0.5 rounded">System</span>}
                                    </div>
                                    {r.description && <span className="text-xs text-slate-500 mt-0.5">{r.description}</span>}
                                  </div>
                                </Select.Option>
                              ))}
                            </Select>
                          </Form.Item>
                        </div>
                      </div>
                    </div>
                    
                    <div className="pt-6 mt-8 border-t border-slate-100 flex items-center justify-end gap-3">
                      <Button 
                        type="default"
                        onClick={() => {
                          setEditingUser(null);
                          setCurrentView('list');
                        }}
                        className="h-11 px-6 font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 border-slate-200"
                      >
                        Cancel
                      </Button>
                      <Button 
                        type="primary" 
                        htmlType="submit"
                        className="h-11 px-8 font-medium text-white bg-[#111827] hover:bg-[#1F2937] border-transparent shadow-sm flex items-center gap-2.5 rounded-md transition-colors"
                      >
                        <Save size={18} />
                        Save Changes
                      </Button>
                    </div>
                  </Form>
                )}
              </div>
            </div>
          )}
        </ConfigProvider>
      </div>

    </AppShell>
    </>
  );
}
