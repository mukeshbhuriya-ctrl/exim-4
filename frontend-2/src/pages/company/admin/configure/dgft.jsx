import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Input, InputNumber, Space, Tag, Typography, message, Row, Col, Skeleton, Badge } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Title, Text } = Typography

const sectionCardStyle = {
  background: '#ffffff',
  borderRadius: 8,
  padding: 24,
  boxShadow: '0 1px 2px rgba(0,0,0,0.03), 0 1px 6px -1px rgba(0,0,0,0.02)',
  borderTop: '4px solid #1677ff',
}

const CONFIGURE_DGFT_BASE = '/api/company/admin/configure/dgft'

export default function CompanyAdminConfigureDgftPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [maxLoginRetries, setMaxLoginRetries] = useState(8)
  const [configured, setConfigured] = useState(null)
  
  const [alertEmails, setAlertEmails] = useState([''])
  const [loadingAlertEmails, setLoadingAlertEmails] = useState(false)
  const [savingAlertEmails, setSavingAlertEmails] = useState(false)
  
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  
  // UI states
  const [isEditingCreds, setIsEditingCreds] = useState(false)
  const [isEditingAlerts, setIsEditingAlerts] = useState(false)

  const loadCredentials = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}${CONFIGURE_DGFT_BASE}/get-id-pass`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load credentials (${res.status})`)
      }
      const dgft = data?.dgft && typeof data.dgft === 'object' ? data.dgft : data
      const id = String(dgft?.id ?? dgft?.username ?? '').trim()
      const pw = dgft?.password != null ? String(dgft.password) : ''
      setUserId(id)
      setPassword(pw)
      setConfigured(Boolean(data?.configured ?? dgft?.configured))
      if (!id && !pw) {
        message.info('No DGFT credentials stored yet.')
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load DGFT credentials')
      setConfigured(false)
    } finally {
      setLoading(false)
    }
  }, [BACKEND_URL])

  const loadAlertEmails = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoadingAlertEmails(true)
    try {
      const res = await fetch(`${BACKEND_URL}${CONFIGURE_DGFT_BASE}/password-alert-emails`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load alert emails (${res.status})`)
      }
      const list = Array.isArray(data.emails) ? data.emails : []
      setAlertEmails(list.length ? list : [''])
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load alert emails')
      setAlertEmails([''])
    } finally {
      setLoadingAlertEmails(false)
    }
  }, [BACKEND_URL])

  const handleSaveAlertEmails = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    const list = [...new Set(alertEmails.map((e) => String(e || '').trim()).filter(Boolean))]
    setSavingAlertEmails(true)
    try {
      const res = await fetch(`${BACKEND_URL}${CONFIGURE_DGFT_BASE}/password-alert-emails`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: list }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Save failed (${res.status})`)
      }
      const saved = Array.isArray(data.emails) ? data.emails : list
      setAlertEmails(saved.length ? saved : [''])
      message.success(data?.message || 'Password alert emails saved.')
      setIsEditingAlerts(false)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save alert emails')
    } finally {
      setSavingAlertEmails(false)
    }
  }, [BACKEND_URL, alertEmails])

  const handleSave = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    const id = userId.trim()
    if (!id || !password) {
      message.error('DGFT user ID and password are required.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`${BACKEND_URL}${CONFIGURE_DGFT_BASE}/add-id-pass`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          password,
          maxLoginRetries: Number(maxLoginRetries || 8),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Save failed (${res.status})`)
      }
      if (data?.success === false) {
        message.warning(data?.message || 'Login verification reported failure')
      } else {
        message.success(data?.message || 'DGFT credentials saved and verified.')
      }
      const dgft = data?.dgft
      if (dgft) {
        setConfigured(Boolean(dgft.configured ?? data?.configured))
      } else {
        setConfigured(true)
      }
      setIsEditingCreds(false)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save DGFT credentials')
    } finally {
      setSaving(false)
    }
  }, [BACKEND_URL, userId, password, maxLoginRetries])

  const handleCancelCreds = () => {
    setIsEditingCreds(false)
    loadCredentials()
  }

  const handleCancelAlerts = () => {
    setIsEditingAlerts(false)
    loadAlertEmails()
  }

  useEffect(() => {
    loadCredentials()
    loadAlertEmails()
  }, [loadCredentials, loadAlertEmails])

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <PageHeader 
        title="DGFT Setup" 
        description="Store DGFT logins used for automated DGFT process runs and configure password failure alerts."
      />

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
          
          {/* DGFT Credentials Section */}
          <div style={sectionCardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Title level={5} style={{ margin: 0, color: 'var(--exim-gray-800)' }}>
                    {isEditingCreds ? 'Configure DGFT Credentials' : 'Active DGFT Credentials'}
                  </Title>
                  {!isEditingCreds && configured != null && (
                    configured 
                      ? <Badge status="success" text="Configured" style={{ padding: '2px 8px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 12, fontSize: 12 }} />
                      : <Badge status="warning" text="Not configured" style={{ padding: '2px 8px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 12, fontSize: 12 }} />
                  )}
                </div>
                <Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
                  {isEditingCreds 
                    ? 'Update the DGFT username and password below.' 
                    : 'Current DGFT credentials for automated processing.'}
                </Text>
              </div>
              <Space wrap>
                {!isEditingCreds && (
                  <Button onClick={loadCredentials} loading={loading}>Reload</Button>
                )}
                {!isEditingCreds && (
                  <Button type="primary" onClick={() => setIsEditingCreds(true)}>Modify Configuration</Button>
                )}
              </Space>
            </div>

            {loading && !isEditingCreds ? (
              <Skeleton active paragraph={{ rows: 2 }} />
            ) : !isEditingCreds ? (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Row gutter={[24, 24]}>
                  <Col xs={24} md={12}>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>DGFT USER ID</Text>
                    <Text strong copyable={!!userId}>{userId || '—'}</Text>
                  </Col>
                  <Col xs={24} md={12}>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>PASSWORD</Text>
                    <Text strong>{password ? '••••••••••••' : '—'}</Text>
                  </Col>
                  <Col xs={24} md={12}>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>MAX LOGIN RETRIES</Text>
                    <Text strong>{maxLoginRetries}</Text>
                  </Col>
                </Row>
                <div style={{ marginTop: 16 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    For one-off manual runs with a different account, use DGFT Manual under the DGFT menu.
                  </Text>
                </div>
              </Space>
            ) : (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Row gutter={[24, 24]}>
                  <Col xs={24} md={12}>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>DGFT User ID</Text>
                    <Input
                      value={userId}
                      onChange={(e) => setUserId(e.target.value)}
                      placeholder="DGFT username"
                      autoComplete="off"
                      disabled={saving}
                    />
                  </Col>
                  <Col xs={24} md={12}>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Password</Text>
                    <Input.Password
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="DGFT password"
                      autoComplete="new-password"
                      disabled={saving}
                    />
                  </Col>
                  <Col xs={24} md={12}>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Max login retries</Text>
                    <InputNumber
                      value={maxLoginRetries}
                      min={1}
                      max={20}
                      onChange={(v) => setMaxLoginRetries(Number(v || 8))}
                      style={{ width: '100%' }}
                      disabled={saving}
                    />
                  </Col>
                </Row>
                <Space wrap style={{ marginTop: 16 }}>
                  <Button onClick={handleCancelCreds}>Cancel</Button>
                  <Button type="primary" loading={saving} onClick={handleSave} disabled={!BACKEND_URL}>Save & verify</Button>
                  <Button onClick={loadCredentials} loading={loading} disabled={saving || !BACKEND_URL}>Reload</Button>
                </Space>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                  For one-off manual runs with a different account, use DGFT Manual under the DGFT menu.
                </Text>
              </Space>
            )}
          </div>

          {/* Password Alerts Section */}
          <div style={sectionCardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
              <div>
                <Title level={5} style={{ margin: 0, color: 'var(--exim-gray-800)' }}>
                  {isEditingAlerts ? 'Configure Password Alerts' : 'Active Password Alerts'}
                </Title>
                <Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
                  {isEditingAlerts 
                    ? 'Update the email addresses that receive failed login alerts.' 
                    : 'When DGFT login fails due to a wrong password, an alert is sent to these addresses.'}
                </Text>
              </div>
              <Space wrap>
                {!isEditingAlerts && (
                  <Button onClick={loadAlertEmails} loading={loadingAlertEmails}>Reload</Button>
                )}
                {!isEditingAlerts && (
                  <Button type="primary" onClick={() => setIsEditingAlerts(true)}>Modify Configuration</Button>
                )}
              </Space>
            </div>

            {loadingAlertEmails && !isEditingAlerts ? (
              <Skeleton active paragraph={{ rows: 2 }} />
            ) : !isEditingAlerts ? (
              <Row gutter={[24, 24]}>
                <Col span={24}>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>ALERT EMAILS</Text>
                  {alertEmails.length && alertEmails[0] !== '' ? (
                    <Space wrap>
                      {alertEmails.filter(e => e.trim()).map((email, idx) => (
                        <Tag key={`email-${idx}`} style={{ padding: '4px 12px', fontSize: 13 }}>{email}</Tag>
                      ))}
                    </Space>
                  ) : (
                    <Text strong>—</Text>
                  )}
                </Col>
              </Row>
            ) : (
              <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: 520 }}>
                {alertEmails.map((email, index) => (
                  <Space key={`dgft-alert-email-${index}`} align="baseline" style={{ display: 'flex', width: '100%' }}>
                    <Input
                      value={email}
                      onChange={(e) =>
                        setAlertEmails((prev) =>
                          prev.map((item, i) => (i === index ? e.target.value : item)),
                        )
                      }
                      placeholder="alert@company.com"
                      style={{ width: 320 }}
                      disabled={savingAlertEmails}
                    />
                    <Button
                      type="text"
                      danger
                      icon={<MinusCircleOutlined />}
                      onClick={() =>
                        setAlertEmails((prev) => {
                          const next = prev.filter((_, i) => i !== index)
                          return next.length ? next : ['']
                        })
                      }
                      disabled={alertEmails.length <= 1 || savingAlertEmails}
                    />
                  </Space>
                ))}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => setAlertEmails((prev) => [...prev, ''])}
                  disabled={savingAlertEmails}
                  style={{ width: 320 }}
                >
                  Add Email
                </Button>
                <Space wrap style={{ marginTop: 16 }}>
                  <Button onClick={handleCancelAlerts}>Cancel</Button>
                  <Button
                    type="primary"
                    loading={savingAlertEmails}
                    onClick={handleSaveAlertEmails}
                    disabled={!BACKEND_URL}
                  >
                    Save alert emails
                  </Button>
                  <Button onClick={loadAlertEmails} loading={loadingAlertEmails} disabled={savingAlertEmails || !BACKEND_URL}>
                    Reload alerts
                  </Button>
                </Space>
              </Space>
            )}
          </div>

        </Space>
    </AppShell>
  )
}
