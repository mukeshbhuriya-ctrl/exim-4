import { Button, Input, Layout, Menu, Modal, Space, Typography, message } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content, Sider } = Layout
const { Title, Text } = Typography

export default function CompanyAdminChaOtpPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingCredentials, setLoadingCredentials] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('gmail')
  const [labelsName, setLabelsName] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [refreshToken, setRefreshToken] = useState('')

  const providers = useMemo(() => [{ key: 'gmail', label: 'Gmail' }], [])

  const applyCredentialData = useCallback((data) => {
    const payload = data?.otpcred?.payload || data?.payload || data || {}
    setLabelsName(
      String(
        payload?.labelsName ||
          payload?.labels_name ||
          payload?.filterName ||
          payload?.filter_name ||
          payload?.name ||
          ''
      ).trim()
    )
    setClientId(String(payload?.clientId || payload?.client_id || '').trim())
    setClientSecret(String(payload?.clientSecret || payload?.client_secret || '').trim())
    setRefreshToken(String(payload?.refreshToken || payload?.refresh_token || '').trim())
  }, [])

  const fetchCredentials = useCallback(
    async ({ showError = true } = {}) => {
      if (!BACKEND_URL) {
        return
      }
      setLoadingCredentials(true)
      try {
        const res = await fetch(`${BACKEND_URL}/api/company/admin/cha/otp/credential`, {
          method: 'GET',
          credentials: 'include',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.detail || data?.message || `Fetch OTP credentials failed (${res.status})`)
        }
        applyCredentialData(data)
      } catch (e) {
        if (showError) {
          message.error(e instanceof Error ? e.message : 'Failed to fetch OTP credentials')
        }
      } finally {
        setLoadingCredentials(false)
      }
    },
    [BACKEND_URL, applyCredentialData]
  )

  const openModal = useCallback(async () => {
    setModalOpen(true)
    await fetchCredentials()
  }, [fetchCredentials])

  const resetModal = useCallback(() => {
    setSelectedProvider('gmail')
    setModalOpen(false)
  }, [])

  const handleSave = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (
      !String(clientId || '').trim() ||
      !String(clientSecret || '').trim() ||
      !String(refreshToken || '').trim()
    ) {
      message.error('Client ID, Client Secret, and Refresh Token are required.')
      return
    }
    setSaving(true)
    try {
      const body = {
        provider: selectedProvider,
        labelsName: String(labelsName || '').trim(),
        clientId: String(clientId || '').trim(),
        clientSecret: String(clientSecret || '').trim(),
        refreshToken: String(refreshToken || '').trim(),
      }
      const res = await fetch(`${BACKEND_URL}/api/company/admin/cha/otp/credential`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Save OTP setup failed (${res.status})`)
      }
      applyCredentialData(body)
      message.success(data?.message || 'OTP setup saved successfully.')
      resetModal()
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to save OTP setup')
    } finally {
      setSaving(false)
    }
  }, [BACKEND_URL, applyCredentialData, clientId, clientSecret, labelsName, refreshToken, resetModal, selectedProvider])

  useEffect(() => {
    fetchCredentials({ showError: false })
  }, [fetchCredentials])

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                CHA OTP Setup
              </Title>
              <Text type="secondary">Configure OTP provider settings by posting JSON payload.</Text>
            </div>

            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Text strong>Current Credentials</Text>
              <Input value={labelsName} placeholder="labelsName" readOnly />
              <Input value={clientId} placeholder="Client ID" readOnly />
              <Input.Password value={clientSecret} placeholder="Client Secret" readOnly />
              <Input.Password value={refreshToken} placeholder="Refresh Token" readOnly />
            </Space>

            <Space>
              <Button type="primary" onClick={openModal} loading={loadingCredentials}>
                Setup OTP
              </Button>
            </Space>
          </Space>
        

      <Modal
        title="Setup OTP"
        open={modalOpen}
        onCancel={resetModal}
        onOk={handleSave}
        okText="Save"
        confirmLoading={saving}
        width={900}
        destroyOnClose
      >
        <Layout style={{ minHeight: 340, border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
          <Sider width={200} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
            <Menu
              mode="inline"
              selectedKeys={[selectedProvider]}
              items={providers}
              onClick={({ key }) => setSelectedProvider(String(key))}
              style={{ height: '100%' }}
            />
          </Sider>
          <Content style={{ padding: 16 }}>
            {selectedProvider === 'gmail' ? (
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Text strong>Gmail Credentials</Text>
                <Input
                  value={labelsName}
                  onChange={(e) => setLabelsName(e.target.value)}
                  placeholder="labelsName"
                />
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Client ID"
                />
                <Input.Password
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Client Secret"
                />
                <Input
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                  placeholder="Refresh Token"
                />
              </Space>
            ) : null}
          
      </Modal>
    </AppShell>
  )
}
