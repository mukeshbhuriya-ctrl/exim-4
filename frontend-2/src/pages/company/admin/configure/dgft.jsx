import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Card, Input, InputNumber, Layout, Space, Tag, Typography, message } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography

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
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save DGFT credentials')
    } finally {
      setSaving(false)
    }
  }, [BACKEND_URL, userId, password, maxLoginRetries])

  useEffect(() => {
    loadCredentials()
    loadAlertEmails()
  }, [loadCredentials, loadAlertEmails])

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                DGFT credentials
              </Title>
              <Text type="secondary">
                Store DGFT login used for automated DGFT process runs.
              </Text>
            </div>

            {configured != null ? (
              <div>
                <Text type="secondary">Status: </Text>
                <Tag color={configured ? 'green' : 'default'}>
                  {configured ? 'Configured' : 'Not configured'}
                </Tag>
              </div>
            ) : null}

            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                  DGFT user ID
                </Text>
                <Input
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="DGFT username"
                  autoComplete="off"
                  disabled={loading || saving}
                />
              </div>
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                  Password
                </Text>
                <Input.Password
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="DGFT password"
                  autoComplete="new-password"
                  disabled={loading || saving}
                />
              </div>
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                  Max login retries
                </Text>
                <InputNumber
                  value={maxLoginRetries}
                  min={1}
                  max={20}
                  onChange={(v) => setMaxLoginRetries(Number(v || 8))}
                  style={{ width: '100%' }}
                  disabled={loading || saving}
                />
              </div>

              <Space wrap>
                <Button type="primary" loading={saving} onClick={handleSave} disabled={!BACKEND_URL}>
                  Save & verify
                </Button>
                <Button onClick={loadCredentials} loading={loading} disabled={!BACKEND_URL}>
                  Reload
                </Button>
              </Space>

              <Text type="secondary" style={{ fontSize: 12 }}>
                For one-off manual runs with a different account, use DGFT Manual under the DGFT menu.
              </Text>
            </Space>

            <Card size="small" title="Password wrong alert emails" loading={loadingAlertEmails}>
              <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: 520 }}>
                <Text type="secondary">
                  When DGFT login fails due to a wrong password, an alert is sent to these email
                  addresses.
                </Text>
                {alertEmails.map((email, index) => (
                  <Space key={`dgft-alert-email-${index}`} align="baseline" style={{ width: '100%' }}>
                    <Input
                      value={email}
                      onChange={(e) =>
                        setAlertEmails((prev) =>
                          prev.map((item, i) => (i === index ? e.target.value : item)),
                        )
                      }
                      placeholder="alert@company.com"
                      style={{ minWidth: 280 }}
                      disabled={loadingAlertEmails || savingAlertEmails}
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
                      disabled={alertEmails.length <= 1 || loadingAlertEmails || savingAlertEmails}
                    />
                  </Space>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={() => setAlertEmails((prev) => [...prev, ''])}
                  disabled={loadingAlertEmails || savingAlertEmails}
                >
                  Add email
                </Button>
                <Space wrap>
                  <Button
                    type="primary"
                    loading={savingAlertEmails}
                    onClick={handleSaveAlertEmails}
                    disabled={!BACKEND_URL}
                  >
                    Save alert emails
                  </Button>
                  <Button onClick={loadAlertEmails} loading={loadingAlertEmails} disabled={!BACKEND_URL}>
                    Reload alerts
                  </Button>
                </Space>
              </Space>
            </Card>
          </Space>
        </AppShell>
  )
}
