import { LinkOutlined, MailOutlined, GoogleOutlined, WindowsOutlined, InfoCircleOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { Button, Form, Input, Layout, Tabs, Space, Tag, Typography, message, Row, Col, Skeleton, Divider, Badge } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography

const sectionCardStyle = {
  background: '#ffffff',
  borderRadius: 8,
  padding: 24,
  boxShadow: '0 1px 2px rgba(0,0,0,0.03), 0 1px 6px -1px rgba(0,0,0,0.02), 0 2px 4px rgba(0,0,0,0.02)',
  borderTop: '4px solid #1677ff',
}

const CONFIGURE_PDF_BASE = '/api/company/admin/configure/pdf'

const MAIL_PROVIDERS = [
  { value: 'gmail', label: 'Gmail' },
  { value: 'outlook', label: 'Outlook' },
]

const DEFAULT_FROM_LABEL = 'INBOX/PDF'
const DEFAULT_TO_LABEL = 'INBOX/Processed'
const DEFAULT_GMAIL_REDIRECT_URI = 'http://localhost:1010/'
const DEFAULT_OUTLOOK_FROM = 'NEW/FINAL_LEO_SB'
const DEFAULT_OUTLOOK_TO = 'PROCESSED/DL_FINAL_LEO_SB'

function isRefreshTokenPending(value) {
  const token = String(value ?? '').trim().toLowerCase()
  return !token || token === 'pending'
}

function isOutlookConfigReady(outlook) {
  if (!outlook) return false
  const mailboxEmail = String(outlook.mailboxEmail || outlook.accountEmail || '').trim()
  return Boolean(
    String(outlook.tenantId || '').trim() &&
    String(outlook.clientId || '').trim() &&
    String(outlook.clientSecret || '').trim() &&
    mailboxEmail &&
    String(outlook.fromFolderName || '').trim() &&
    String(outlook.toFolderName || '').trim(),
  )
}

function extractGmailFromResponse(data) {
  if (!data || typeof data !== 'object') return null
  const gmail = data.pdf?.gmail ?? data.credential
  return gmail && typeof gmail === 'object' ? gmail : null
}

function extractOutlookFromResponse(data) {
  if (!data || typeof data !== 'object') return null
  const outlook = data.pdf?.outlook ?? data.credential
  return outlook && typeof outlook === 'object' ? outlook : null
}

function applyGmailToForm(gmail, form) {
  if (!gmail) return { hasSaved: false, pending: true, data: null }
  const pending = isRefreshTokenPending(gmail.refreshToken)
  const data = {
    clientId: gmail.clientId || '',
    clientSecret: gmail.clientSecret || '',
    redirectUri: gmail.redirectUri || gmail.redirect_uri || DEFAULT_GMAIL_REDIRECT_URI,
    fromlabelname: gmail.fromLabelName || gmail.fromlabelname || DEFAULT_FROM_LABEL,
    tolabelname: gmail.toLabelName || gmail.tolabelname || DEFAULT_TO_LABEL,
  }
  form.setFieldsValue(data)
  return { hasSaved: true, pending, data }
}

function GmailPdfSetup({ backendUrl }) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [oauthStarting, setOauthStarting] = useState(false)
  const [hasSaved, setHasSaved] = useState(false)
  const [refreshTokenPending, setRefreshTokenPending] = useState(true)
  const [isEditing, setIsEditing] = useState(false)

  const [savedData, setSavedData] = useState({
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    fromlabelname: '',
    tolabelname: '',
  })

  const [form] = Form.useForm()

  const oauthPopupRef = useRef(null)
  const oauthPollRef = useRef(null)
  const oauthPollTimeoutRef = useRef(null)
  const oauthCompletedRef = useRef(false)

  const fetchGmailConfig = useCallback(async () => {
    if (!backendUrl) return null
    const res = await fetch(`${backendUrl}${CONFIGURE_PDF_BASE}/get-gmail-credential`, {
      method: 'GET',
      credentials: 'include',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data?.detail || data?.message || `Failed to load Gmail config (${res.status})`)
    }
    return extractGmailFromResponse(data)
  }, [backendUrl])

  const loadConfig = useCallback(async () => {
    if (!backendUrl) return
    setLoading(true)
    try {
      const gmail = await fetchGmailConfig()
      if (gmail) {
        const status = applyGmailToForm(gmail, form)
        setHasSaved(status.hasSaved)
        setRefreshTokenPending(status.pending)
        if (status.data) setSavedData(status.data)
      } else {
        form.setFieldsValue({
          redirectUri: DEFAULT_GMAIL_REDIRECT_URI,
          fromlabelname: DEFAULT_FROM_LABEL,
          tolabelname: DEFAULT_TO_LABEL,
        })
        setHasSaved(false)
        setRefreshTokenPending(true)
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load Gmail configuration')
      setHasSaved(false)
      setRefreshTokenPending(true)
    } finally {
      setLoading(false)
    }
  }, [backendUrl, fetchGmailConfig, form])

  const clearOAuthWatchers = useCallback(() => {
    if (oauthPollRef.current) {
      clearInterval(oauthPollRef.current)
      oauthPollRef.current = null
    }
    if (oauthPollTimeoutRef.current) {
      clearTimeout(oauthPollTimeoutRef.current)
      oauthPollTimeoutRef.current = null
    }
    oauthPopupRef.current = null
    setOauthStarting(false)
  }, [])

  const handleOAuthSuccess = useCallback(
    async (payload) => {
      if (oauthCompletedRef.current) return
      oauthCompletedRef.current = true
      clearOAuthWatchers()

      const popup = oauthPopupRef.current
      if (popup && !popup.closed) {
        try {
          popup.close()
        } catch {
          // ignore
        }
      }

      const gmail = extractGmailFromResponse(payload) ?? payload?.pdf?.gmail
      if (gmail) {
        const status = applyGmailToForm(gmail, form)
        setHasSaved(status.hasSaved)
        setRefreshTokenPending(status.pending)
        if (status.data) setSavedData(status.data)
      }

      try {
        const verified = await fetchGmailConfig()
        if (verified) {
          const status = applyGmailToForm(verified, form)
          setHasSaved(status.hasSaved)
          setRefreshTokenPending(status.pending)
          if (status.data) setSavedData(status.data)
          if (!status.pending) {
            message.success('Gmail connected. Refresh token is saved.')
          } else {
            message.warning('Authorization finished, but refresh token is still pending.')
          }
        }
      } catch (err) {
        message.warning(
          err instanceof Error ? err.message : 'Could not verify Gmail config after authorization.',
        )
      }
    },
    [clearOAuthWatchers, fetchGmailConfig, form],
  )

  const startOAuthPolling = useCallback(() => {
    if (oauthPollRef.current) return
    oauthPollRef.current = window.setInterval(async () => {
      try {
        const gmail = await fetchGmailConfig()
        if (gmail && !isRefreshTokenPending(gmail.refreshToken)) {
          await handleOAuthSuccess({ pdf: { gmail } })
        }
      } catch {
        // keep polling
      }
    }, 2000)
    oauthPollTimeoutRef.current = window.setTimeout(() => {
      clearOAuthWatchers()
      message.warning('Gmail authorization timed out. Try Connect Gmail again.')
    }, 15 * 60 * 1000)
  }, [clearOAuthWatchers, fetchGmailConfig, handleOAuthSuccess])

  const handleConnectGmail = async () => {
    if (!backendUrl) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!hasSaved) {
      message.warning('Save client ID, secret, and labels before connecting Gmail.')
      return
    }

    setOauthStarting(true)
    oauthCompletedRef.current = false
    try {
      const res = await fetch(`${backendUrl}${CONFIGURE_PDF_BASE}/get-gmail-refresh-token`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to start Gmail OAuth (${res.status})`)
      }

      const verificationUrl = String(data.verificationUrl || data.authUrl || '').trim()
      if (!verificationUrl) {
        throw new Error('Backend did not return a verification URL.')
      }

      const popup = window.open(
        verificationUrl,
        'gmail-oauth',
        'popup=yes,width=520,height=720,menubar=no,toolbar=no,location=yes,status=yes,resizable=yes,scrollbars=yes',
      )

      if (popup) {
        oauthPopupRef.current = popup
        popup.focus()
        startOAuthPolling()
        const popupWatcher = window.setInterval(() => {
          if (!oauthPopupRef.current?.closed) return
          window.clearInterval(popupWatcher)
          if (!oauthPollRef.current) return
          window.setTimeout(async () => {
            try {
              const gmail = await fetchGmailConfig()
              if (gmail && !isRefreshTokenPending(gmail.refreshToken)) {
                await handleOAuthSuccess({ pdf: { gmail } })
              }
            } catch {
              // interval handles fallback
            }
          }, 1500)
        }, 500)
      } else {
        window.open(verificationUrl, '_blank', 'noopener,noreferrer')
        message.info('Gmail sign-in opened in a new tab. Complete authorization, then return here.')
        startOAuthPolling()
      }
    } catch (err) {
      clearOAuthWatchers()
      message.error(err instanceof Error ? err.message : 'Failed to start Gmail OAuth')
    } finally {
      if (!oauthPollRef.current) setOauthStarting(false)
    }
  }

  const handleSave = async () => {
    if (!backendUrl) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    let values
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    setSaving(true)
    try {
      const body = {
        clientId: String(values.clientId || '').trim(),
        clientSecret: String(values.clientSecret || '').trim(),
        redirectUri: String(values.redirectUri || '').trim(),
        fromlabelname: String(values.fromlabelname || '').trim(),
        tolabelname: String(values.tolabelname || '').trim(),
      }
      const res = await fetch(`${backendUrl}${CONFIGURE_PDF_BASE}/create-gmail-credential`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to save Gmail config (${res.status})`)
      }
      message.success(data?.message || 'Gmail configuration saved.')
      const gmail = extractGmailFromResponse(data)
      if (gmail) {
        const status = applyGmailToForm(gmail, form)
        setHasSaved(status.hasSaved)
        setRefreshTokenPending(status.pending)
        if (status.data) setSavedData(status.data)
      } else {
        setHasSaved(true)
        setRefreshTokenPending(true)
        setSavedData(body)
      }
      setIsEditing(false)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save Gmail configuration')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    form.setFieldsValue(savedData)
    setIsEditing(false)
  }

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useEffect(() => {
    const frontendOrigin = window.location.origin
    const onMessage = (event) => {
      if (event.data?.type !== 'GMAIL_OAUTH_SUCCESS') return
      if (event.origin !== frontendOrigin) return
      handleOAuthSuccess(event.data)
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      clearOAuthWatchers()
    }
  }, [clearOAuthWatchers, handleOAuthSuccess])

  const oauthDone = hasSaved && !refreshTokenPending

  return (
    <div style={sectionCardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Title level={5} style={{ margin: 0, color: 'var(--exim-gray-800)' }}>
              {isEditing ? 'Configure Gmail Settings' : 'Active Gmail Configuration'}
            </Title>
            {!isEditing && hasSaved && (
              oauthDone 
                ? <Badge status="success" text="Connected" style={{ padding: '2px 8px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 12, fontSize: 12 }} />
                : <Badge status="warning" text="Refresh token pending" style={{ padding: '2px 8px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 12, fontSize: 12 }} />
            )}
          </div>
          <Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
            {isEditing 
              ? 'Update OAuth app credentials below.' 
              : 'Current OAuth details for the Gmail PDF mailbox.'}
          </Text>
        </div>
        <Space wrap>
          {!isEditing && (
            <Button onClick={loadConfig} loading={loading}>Reload</Button>
          )}
          {!isEditing && hasSaved && !oauthDone && (
            <Button
              type="primary"
              icon={<LinkOutlined />}
              loading={oauthStarting}
              onClick={handleConnectGmail}
              disabled={saving}
            >
              Connect Gmail
            </Button>
          )}
          {!isEditing && (
            <Button type="primary" onClick={() => setIsEditing(true)}>Modify Configuration</Button>
          )}
        </Space>
      </div>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : !isEditing ? (
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Divider orientation="left" style={{ margin: 0, fontSize: 14 }}>OAuth Setup</Divider>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>CLIENT ID</Text>
            <Text strong copyable={!!savedData.clientId}>{savedData.clientId || '-'}</Text>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>CLIENT SECRET</Text>
            <Text strong>{savedData.clientSecret ? '••••••••••••' : '-'}</Text>
          </Col>
          <Col xs={24} md={24}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>REDIRECT URI</Text>
            <Text strong copyable={!!savedData.redirectUri}>{savedData.redirectUri || '-'}</Text>
          </Col>

          <Col span={24}>
            <Divider orientation="left" style={{ marginTop: 8, marginBottom: 0, fontSize: 14 }}>Label Mapping</Divider>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>FROM LABEL NAME</Text>
            <Text strong>{savedData.fromlabelname || '-'}</Text>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>TO LABEL NAME</Text>
            <Text strong>{savedData.tolabelname || '-'}</Text>
          </Col>
        </Row>
      ) : (
        <Form
          form={form}
          layout="vertical"
          disabled={loading || saving || oauthStarting}
          style={{ maxWidth: 800 }}
        >
          <Row gutter={24}>
            <Col xs={24}>
              <Divider orientation="left" style={{ margin: 0, marginBottom: 16, fontSize: 14 }}>OAuth Setup</Divider>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="clientId"
                label="Client ID"
                rules={[{ required: true, message: 'Client ID is required' }]}
              >
                <Input placeholder="OAuth client ID" autoComplete="off" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="clientSecret"
                label="Client Secret"
                rules={[{ required: true, message: 'Client secret is required' }]}
              >
                <Input.Password placeholder="OAuth client secret" autoComplete="off" />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item
                name="redirectUri"
                label="Redirect URI"
                extra="Must match the authorized redirect URI in Google Cloud Console (used for OAuth callback)."
                rules={[{ required: true, message: 'Redirect URI is required' }]}
              >
                <Input placeholder={DEFAULT_GMAIL_REDIRECT_URI} autoComplete="off" />
              </Form.Item>
            </Col>

            <Col xs={24}>
              <Divider orientation="left" style={{ margin: 0, marginBottom: 16, fontSize: 14 }}>Label Mapping</Divider>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="fromlabelname"
                label="From label name"
                rules={[{ required: true, message: 'From label name is required' }]}
              >
                <Input placeholder={DEFAULT_FROM_LABEL} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="tolabelname"
                label="To label name"
                rules={[{ required: true, message: 'To label name is required' }]}
              >
                <Input placeholder={DEFAULT_TO_LABEL} />
              </Form.Item>
            </Col>
          </Row>

          <Space wrap style={{ marginTop: 16 }}>
            <Button onClick={handleCancel}>Cancel</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>
              Save configuration
            </Button>
            <Button onClick={loadConfig} loading={loading} disabled={saving || oauthStarting}>
              Reload
            </Button>
            {hasSaved && refreshTokenPending ? (
              <Button
                icon={<LinkOutlined />}
                loading={oauthStarting}
                onClick={handleConnectGmail}
                disabled={saving}
              >
                Connect Gmail
              </Button>
            ) : null}
          </Space>
        </Form>
      )}
    </div>
  )
}

function applyOutlookToForm(outlook, form) {
  if (!outlook) return { hasSaved: false, ready: false, data: null }
  const ready = isOutlookConfigReady(outlook)
  const mailboxEmail = String(outlook.mailboxEmail || outlook.accountEmail || '').trim()
  const data = {
    tenantId: outlook.tenantId || '',
    clientId: outlook.clientId || '',
    clientSecret: outlook.clientSecret || '',
    mailboxEmail,
    fromFolderName: outlook.fromFolderName || outlook.fromfoldername || DEFAULT_OUTLOOK_FROM,
    toFolderName: outlook.toFolderName || outlook.tofoldername || DEFAULT_OUTLOOK_TO,
  }
  form.setFieldsValue(data)
  return { hasSaved: true, ready, mailboxEmail, data }
}

function OutlookPdfSetup({ backendUrl, onConfigSaved }) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hasSaved, setHasSaved] = useState(false)
  const [configReady, setConfigReady] = useState(false)
  const [mailboxEmail, setMailboxEmail] = useState('')
  const [isEditing, setIsEditing] = useState(false)

  const [savedData, setSavedData] = useState({
    tenantId: '',
    clientId: '',
    clientSecret: '',
    mailboxEmail: '',
    fromFolderName: '',
    toFolderName: '',
  })

  const [form] = Form.useForm()

  const fetchOutlookConfig = useCallback(async () => {
    if (!backendUrl) return null
    const res = await fetch(`${backendUrl}${CONFIGURE_PDF_BASE}/get-outlook-credential`, {
      method: 'GET',
      credentials: 'include',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data?.detail || data?.message || `Failed to load Outlook config (${res.status})`)
    }
    return extractOutlookFromResponse(data)
  }, [backendUrl])

  const loadConfig = useCallback(async () => {
    if (!backendUrl) return
    setLoading(true)
    try {
      const outlook = await fetchOutlookConfig()
      if (outlook) {
        const status = applyOutlookToForm(outlook, form)
        setHasSaved(status.hasSaved)
        setConfigReady(status.ready)
        setMailboxEmail(status.mailboxEmail)
        if (status.data) setSavedData(status.data)
      } else {
        form.setFieldsValue({
          fromFolderName: DEFAULT_OUTLOOK_FROM,
          toFolderName: DEFAULT_OUTLOOK_TO,
        })
        setHasSaved(false)
        setConfigReady(false)
        setMailboxEmail('')
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load Outlook configuration')
      setHasSaved(false)
      setConfigReady(false)
      setMailboxEmail('')
    } finally {
      setLoading(false)
    }
  }, [backendUrl, fetchOutlookConfig, form])

  const handleSave = async () => {
    if (!backendUrl) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    let values
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    setSaving(true)
    try {
      const body = {
        tenantId: String(values.tenantId || '').trim(),
        clientId: String(values.clientId || '').trim(),
        clientSecret: String(values.clientSecret || '').trim(),
        mailboxEmail: String(values.mailboxEmail || '').trim(),
        fromFolderName: String(values.fromFolderName || '').trim(),
        toFolderName: String(values.toFolderName || '').trim(),
      }
      const res = await fetch(`${backendUrl}${CONFIGURE_PDF_BASE}/create-outlook-credential`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to save Outlook config (${res.status})`)
      }
      message.success(data?.message || 'Outlook configuration saved.')
      const outlook = extractOutlookFromResponse(data)
      if (outlook) {
        const status = applyOutlookToForm(outlook, form)
        setHasSaved(status.hasSaved)
        setConfigReady(status.ready)
        setMailboxEmail(status.mailboxEmail)
        if (status.data) setSavedData(status.data)
        onConfigSaved?.()
        if (status.ready) {
          message.info('Click Use Outlook in the banner above to make it the active PDF mailbox provider.')
        }
      } else {
        setHasSaved(true)
        setConfigReady(true)
        setSavedData(body)
        onConfigSaved?.()
        message.info('Click Use Outlook in the banner above to make it the active PDF mailbox provider.')
      }
      setIsEditing(false)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save Outlook configuration')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    form.setFieldsValue(savedData)
    setIsEditing(false)
  }

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  return (
    <div style={sectionCardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Title level={5} style={{ margin: 0, color: 'var(--exim-gray-800)' }}>
              {isEditing ? 'Configure Outlook Settings' : 'Active Outlook Configuration'}
            </Title>
            {!isEditing && hasSaved && configReady && (
              <Badge status="success" text="Ready" style={{ padding: '2px 8px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 12, fontSize: 12 }} />
            )}
          </div>
          <Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
            {isEditing 
              ? 'Update Microsoft Graph app credentials below.' 
              : 'Current Graph app details for the Outlook PDF mailbox.'}
          </Text>
        </div>
        <Space wrap>
          {!isEditing && (
            <Button onClick={loadConfig} loading={loading}>Reload</Button>
          )}
          {!isEditing && (
            <Button type="primary" onClick={() => setIsEditing(true)}>Modify Configuration</Button>
          )}
        </Space>
      </div>

      {!isEditing && (
        <div style={{ marginBottom: 24, padding: '12px 16px', background: '#f0f5ff', border: '1px solid #adc6ff', borderRadius: 6, display: 'flex', gap: 12 }}>
          <InfoCircleOutlined style={{ color: '#1677ff', fontSize: 16, marginTop: 2 }} />
          <div>
            <Text strong style={{ fontSize: 13, display: 'block', color: '#0958d9' }}>Microsoft Graph — app-only access</Text>
            <Text style={{ fontSize: 13, color: '#1677ff' }}>No user sign-in or redirect URI needed. Azure app must have Application permission <strong>Mail.ReadWrite</strong> with admin consent granted once in the tenant.</Text>
          </div>
        </div>
      )}

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : !isEditing ? (
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Divider orientation="left" style={{ margin: 0, fontSize: 14 }}>Application Setup</Divider>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>TENANT ID</Text>
            <Text strong copyable={!!savedData.tenantId}>{savedData.tenantId || '-'}</Text>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>APPLICATION (CLIENT) ID</Text>
            <Text strong copyable={!!savedData.clientId}>{savedData.clientId || '-'}</Text>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>CLIENT SECRET</Text>
            <Text strong>{savedData.clientSecret ? '••••••••••••' : '-'}</Text>
          </Col>

          <Col span={24}>
            <Divider orientation="left" style={{ marginTop: 8, marginBottom: 0, fontSize: 14 }}>Mailbox Mapping</Divider>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>MAILBOX EMAIL</Text>
            <Text strong copyable={!!savedData.mailboxEmail}>{savedData.mailboxEmail || '-'}</Text>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>FROM FOLDER NAME</Text>
            <Text strong>{savedData.fromFolderName || '-'}</Text>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>TO FOLDER NAME</Text>
            <Text strong>{savedData.toFolderName || '-'}</Text>
          </Col>
        </Row>
      ) : (
        <Form
          form={form}
          layout="vertical"
          disabled={loading || saving}
          style={{ maxWidth: 800 }}
        >
          <Row gutter={24}>
            <Col xs={24}>
              <Divider orientation="left" style={{ margin: 0, marginBottom: 16, fontSize: 14 }}>Application Setup</Divider>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="tenantId"
                label="Tenant ID"
                extra="Azure AD directory (tenant) ID."
                rules={[{ required: true, message: 'Tenant ID is required' }]}
              >
                <Input placeholder="Azure directory (tenant) ID" autoComplete="off" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="clientId"
                label="Application (client) ID"
                rules={[{ required: true, message: 'Client ID is required' }]}
              >
                <Input placeholder="Azure app client ID" autoComplete="off" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="clientSecret"
                label="Client Secret"
                extra="Use the secret value from Azure, not the secret ID."
                rules={[{ required: true, message: 'Client secret is required' }]}
              >
                <Input.Password placeholder="Azure client secret" autoComplete="off" />
              </Form.Item>
            </Col>

            <Col xs={24}>
              <Divider orientation="left" style={{ margin: 0, marginBottom: 16, fontSize: 14 }}>Mailbox Mapping</Divider>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="mailboxEmail"
                label="Mailbox email"
                extra="Target mailbox to read and move messages (e.g. Icegate.documents@company.com)."
                rules={[
                  { required: true, message: 'Mailbox email is required' },
                  { type: 'email', message: 'Enter a valid email address' },
                ]}
              >
                <Input placeholder="user@company.com" autoComplete="off" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="fromFolderName"
                label="From folder name"
                extra="Source folder path for PDF mail (e.g. NEW/FINAL_LEO_SB)."
                rules={[{ required: true, message: 'From folder name is required' }]}
              >
                <Input placeholder={DEFAULT_OUTLOOK_FROM} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="toFolderName"
                label="To folder name"
                extra="Folder to move processed mail into."
                rules={[{ required: true, message: 'To folder name is required' }]}
              >
                <Input placeholder={DEFAULT_OUTLOOK_TO} />
              </Form.Item>
            </Col>
          </Row>

          <Space wrap style={{ marginTop: 16 }}>
            <Button onClick={handleCancel}>Cancel</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>
              Save configuration
            </Button>
            <Button onClick={loadConfig} loading={loading} disabled={saving}>
              Reload
            </Button>
          </Space>
        </Form>
      )}
    </div>
  )
}

function PdfMailboxProviderBanner({
  backendUrl,
  selectedProvider,
  onProviderChange,
  onStatusLoaded,
  refreshToken = 0,
}) {
  const [loading, setLoading] = useState(false)
  const [activating, setActivating] = useState(false)
  const [status, setStatus] = useState(null)

  const loadStatus = useCallback(async () => {
    if (!backendUrl) return
    setLoading(true)
    try {
      const res = await fetch(`${backendUrl}${CONFIGURE_PDF_BASE}/mailbox-status`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load mailbox status (${res.status})`)
      }
      const next = {
        provider: String(data.provider || '').trim().toLowerCase(),
        gmail: data.gmail || {},
        outlook: data.outlook || {},
        gmailReady: Boolean(data.gmail?.ready),
        outlookReady: Boolean(data.outlook?.ready),
      }
      setStatus(next)
      onStatusLoaded?.(next)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load mailbox provider status')
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [backendUrl, onStatusLoaded])

  const handleSetProvider = async (provider) => {
    if (!backendUrl) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    setActivating(true)
    try {
      const res = await fetch(`${backendUrl}${CONFIGURE_PDF_BASE}/set-mailbox-provider`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to set mailbox provider (${res.status})`)
      }
      message.success(data?.message || `Active mailbox provider set to ${provider}.`)
      await loadStatus()
      onProviderChange?.(provider)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to set mailbox provider')
    } finally {
      setActivating(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [loadStatus, refreshToken])

  const activeProvider = status?.provider || ''
  const selectedReady =
    selectedProvider === 'gmail' ? status?.gmailReady : selectedProvider === 'outlook' ? status?.outlookReady : false
  const isActive = activeProvider === selectedProvider

  const outlookMailbox = String(status?.outlook?.mailboxEmail || '').trim()
  const outlookFrom = String(status?.outlook?.fromFolderName || '').trim()
  const outlookTo = String(status?.outlook?.toFolderName || '').trim()

  let description = 'Configure Gmail or Outlook below. Only one provider runs for PDF fetch and automation.'
  if (activeProvider === 'outlook' && outlookMailbox) {
    description = `PDF fetch uses Outlook app-only access for ${outlookMailbox}`
    if (outlookFrom && outlookTo) {
      description += ` (${outlookFrom} → ${outlookTo}).`
    } else {
      description += '.'
    }
  } else if (activeProvider === 'gmail') {
    description = 'PDF fetch and automation currently use Gmail.'
  } else if (status) {
    description = 'No active provider selected. Save one provider below, then click Use Gmail or Use Outlook.'
  }

  if (selectedProvider === 'outlook' && !activeProvider && status?.outlookReady && outlookMailbox) {
    description = `Outlook is configured for ${outlookMailbox}. Click Use Outlook to activate it for PDF fetch.`
  }

  return (
    <div style={{ 
      padding: '16px 24px', 
      background: '#fafafa', 
      border: '1px solid #f0f0f0', 
      borderRadius: 8, 
      display: 'flex', 
      justifyContent: 'space-between', 
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 16
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {activeProvider ? (
          <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18, marginTop: 2 }} />
        ) : (
          <ExclamationCircleOutlined style={{ color: '#faad14', fontSize: 18, marginTop: 2 }} />
        )}
        <div>
          <Text strong style={{ display: 'block', fontSize: 14 }}>
            {activeProvider ? `Active provider: ${activeProvider === 'gmail' ? 'Gmail' : 'Outlook'}` : 'No active mailbox provider'}
          </Text>
          <Text type="secondary" style={{ fontSize: 13 }}>{description}</Text>
        </div>
      </div>
      <Space wrap>
        <Button size="small" onClick={loadStatus} loading={loading}>
          Refresh status
        </Button>
        {selectedReady && !isActive ? (
          <Button
            size="small"
            type="primary"
            loading={activating}
            onClick={() => handleSetProvider(selectedProvider)}
          >
            Use {selectedProvider === 'gmail' ? 'Gmail' : 'Outlook'}
          </Button>
        ) : null}
        {isActive && selectedReady ? (
          <div style={{ padding: '4px 12px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 4 }}>
            <Badge status="success" text="Active" />
          </div>
        ) : null}
      </Space>
    </div>
  )
}

export default function CompanyAdminConfigurePdfPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')
  const [selectedProvider, setSelectedProvider] = useState('gmail')
  const [statusRefreshToken, setStatusRefreshToken] = useState(0)
  const [providerSynced, setProviderSynced] = useState(false)

  const handleStatusLoaded = useCallback((status) => {
    if (providerSynced) return
    if (status.provider === 'gmail' || status.provider === 'outlook') {
      setSelectedProvider(status.provider)
    } else if (status.outlookReady && !status.gmailReady) {
      setSelectedProvider('outlook')
    }
    setProviderSynced(true)
  }, [providerSynced])

  const handleOutlookConfigSaved = useCallback(() => {
    setStatusRefreshToken((value) => value + 1)
  }, [])

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <PageHeader
        title="PDF Mailbox Configuration"
        description="Configure mailbox provider credentials for PDF fetch from email."
      />

      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <PdfMailboxProviderBanner
          backendUrl={BACKEND_URL}
          selectedProvider={selectedProvider}
          onProviderChange={setSelectedProvider}
          onStatusLoaded={handleStatusLoaded}
          refreshToken={statusRefreshToken}
        />

        <Tabs
          activeKey={selectedProvider}
          onChange={(key) => setSelectedProvider(key)}
          size="large"
          items={[
            {
              key: 'gmail',
              label: 'Gmail',
              icon: <GoogleOutlined />,
              children: <GmailPdfSetup backendUrl={BACKEND_URL} />,
            },
            {
              key: 'outlook',
              label: 'Outlook',
              icon: <WindowsOutlined />,
              children: <OutlookPdfSetup backendUrl={BACKEND_URL} onConfigSaved={handleOutlookConfigSaved} />,
            },
          ]}
        />
      </div>
    </AppShell>
  )
}
