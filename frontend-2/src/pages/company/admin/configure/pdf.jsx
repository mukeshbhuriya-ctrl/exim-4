import { LinkOutlined, MailOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input, Layout, Segmented, Space, Tag, Typography, message } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography

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
  if (!gmail) return { hasSaved: false, pending: true }
  const pending = isRefreshTokenPending(gmail.refreshToken)
  form.setFieldsValue({
    clientId: gmail.clientId || '',
    clientSecret: gmail.clientSecret || '',
    redirectUri: gmail.redirectUri || gmail.redirect_uri || DEFAULT_GMAIL_REDIRECT_URI,
    fromlabelname: gmail.fromLabelName || gmail.fromlabelname || DEFAULT_FROM_LABEL,
    tolabelname: gmail.toLabelName || gmail.tolabelname || DEFAULT_TO_LABEL,
  })
  return { hasSaved: true, pending }
}

function GmailPdfSetup({ backendUrl }) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [oauthStarting, setOauthStarting] = useState(false)
  const [hasSaved, setHasSaved] = useState(false)
  const [refreshTokenPending, setRefreshTokenPending] = useState(true)
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
      }

      try {
        const verified = await fetchGmailConfig()
        if (verified) {
          const status = applyGmailToForm(verified, form)
          setHasSaved(status.hasSaved)
          setRefreshTokenPending(status.pending)
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
      } else {
        setHasSaved(true)
        setRefreshTokenPending(true)
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save Gmail configuration')
    } finally {
      setSaving(false)
    }
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
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {hasSaved ? (
        <Alert
          type={oauthDone ? 'success' : 'warning'}
          showIcon
          message={oauthDone ? 'Gmail connected' : 'Refresh token pending'}
          description={
            oauthDone
              ? 'Mailbox fetch can use these Gmail credentials.'
              : 'Save settings below if needed, then click Connect Gmail to complete OAuth.'
          }
          action={
            !oauthDone ? (
              <Button
                size="small"
                type="primary"
                icon={<LinkOutlined />}
                loading={oauthStarting}
                onClick={handleConnectGmail}
                disabled={saving}
              >
                Connect Gmail
              </Button>
            ) : (
              <Tag color="success">Ready</Tag>
            )
          }
        />
      ) : null}

      <Form
        form={form}
        layout="vertical"
        disabled={loading || saving || oauthStarting}
        initialValues={{
          redirectUri: DEFAULT_GMAIL_REDIRECT_URI,
          fromlabelname: DEFAULT_FROM_LABEL,
          tolabelname: DEFAULT_TO_LABEL,
        }}
      >
        <Form.Item
          name="clientId"
          label="Client ID"
          rules={[{ required: true, message: 'Client ID is required' }]}
        >
          <Input placeholder="OAuth client ID" autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="clientSecret"
          label="Client Secret"
          rules={[{ required: true, message: 'Client secret is required' }]}
        >
          <Input.Password placeholder="OAuth client secret" autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="redirectUri"
          label="Redirect URI"
          extra="Must match the authorized redirect URI in Google Cloud Console (used for OAuth callback)."
          rules={[{ required: true, message: 'Redirect URI is required' }]}
        >
          <Input placeholder={DEFAULT_GMAIL_REDIRECT_URI} autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="fromlabelname"
          label="From label name"
          rules={[{ required: true, message: 'From label name is required' }]}
        >
          <Input placeholder={DEFAULT_FROM_LABEL} />
        </Form.Item>
        <Form.Item
          name="tolabelname"
          label="To label name"
          rules={[{ required: true, message: 'To label name is required' }]}
        >
          <Input placeholder={DEFAULT_TO_LABEL} />
        </Form.Item>

        <Space wrap>
          <Button type="primary" loading={saving} onClick={handleSave}>
            Save configuration
          </Button>
          <Button onClick={loadConfig} loading={loading}>
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
    </Space>
  )
}

function applyOutlookToForm(outlook, form) {
  if (!outlook) return { hasSaved: false, ready: false }
  const ready = isOutlookConfigReady(outlook)
  const mailboxEmail = String(outlook.mailboxEmail || outlook.accountEmail || '').trim()
  form.setFieldsValue({
    tenantId: outlook.tenantId || '',
    clientId: outlook.clientId || '',
    clientSecret: outlook.clientSecret || '',
    mailboxEmail,
    fromFolderName: outlook.fromFolderName || outlook.fromfoldername || DEFAULT_OUTLOOK_FROM,
    toFolderName: outlook.toFolderName || outlook.tofoldername || DEFAULT_OUTLOOK_TO,
  })
  return { hasSaved: true, ready, mailboxEmail }
}

function OutlookPdfSetup({ backendUrl, onConfigSaved }) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hasSaved, setHasSaved] = useState(false)
  const [configReady, setConfigReady] = useState(false)
  const [mailboxEmail, setMailboxEmail] = useState('')
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
        onConfigSaved?.()
        if (status.ready) {
          message.info('Click Use Outlook in the banner above to make it the active PDF mailbox provider.')
        }
      } else {
        setHasSaved(true)
        setConfigReady(true)
        onConfigSaved?.()
        message.info('Click Use Outlook in the banner above to make it the active PDF mailbox provider.')
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save Outlook configuration')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="Microsoft Graph — app-only access"
        description="No user sign-in or redirect URI needed. Azure app must have Application permission Mail.ReadWrite with admin consent granted once in the tenant."
      />

      {hasSaved && configReady ? (
        <Alert
          type="success"
          showIcon
          message="Outlook configured"
          description={
            mailboxEmail
              ? `PDF fetch will read ${mailboxEmail} using app-only Graph access.`
              : 'Outlook credentials are saved and ready.'
          }
          action={<Tag color="success">Ready</Tag>}
        />
      ) : null}

      <Form
        form={form}
        layout="vertical"
        disabled={loading || saving}
        initialValues={{
          fromFolderName: DEFAULT_OUTLOOK_FROM,
          toFolderName: DEFAULT_OUTLOOK_TO,
        }}
      >
        <Form.Item
          name="tenantId"
          label="Tenant ID"
          extra="Azure AD directory (tenant) ID."
          rules={[{ required: true, message: 'Tenant ID is required' }]}
        >
          <Input placeholder="Azure directory (tenant) ID" autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="clientId"
          label="Application (client) ID"
          rules={[{ required: true, message: 'Client ID is required' }]}
        >
          <Input placeholder="Azure app client ID" autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="clientSecret"
          label="Client Secret"
          extra="Use the secret value from Azure, not the secret ID."
          rules={[{ required: true, message: 'Client secret is required' }]}
        >
          <Input.Password placeholder="Azure client secret" autoComplete="off" />
        </Form.Item>
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
        <Form.Item
          name="fromFolderName"
          label="From folder name"
          extra="Source folder path for PDF mail (e.g. NEW/FINAL_LEO_SB)."
          rules={[{ required: true, message: 'From folder name is required' }]}
        >
          <Input placeholder={DEFAULT_OUTLOOK_FROM} />
        </Form.Item>
        <Form.Item
          name="toFolderName"
          label="To folder name"
          extra="Folder to move processed mail into."
          rules={[{ required: true, message: 'To folder name is required' }]}
        >
          <Input placeholder={DEFAULT_OUTLOOK_TO} />
        </Form.Item>

        <Space wrap>
          <Button type="primary" loading={saving} onClick={handleSave}>
            Save configuration
          </Button>
          <Button onClick={loadConfig} loading={loading}>
            Reload
          </Button>
        </Space>
      </Form>
    </Space>
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
    <Alert
      type={activeProvider ? 'info' : 'warning'}
      showIcon
      message={activeProvider ? `Active provider: ${activeProvider}` : 'No active mailbox provider'}
      description={description}
      action={
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
          {isActive && selectedReady ? <Tag color="success">Active</Tag> : null}
        </Space>
      }
    />
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
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                <MailOutlined style={{ marginRight: 8 }} />
                PDF — Mailbox setup
              </Title>
              <Text type="secondary">
                Configure mailbox provider credentials for PDF fetch from email.
              </Text>
            </div>

            <PdfMailboxProviderBanner
              backendUrl={BACKEND_URL}
              selectedProvider={selectedProvider}
              onProviderChange={setSelectedProvider}
              onStatusLoaded={handleStatusLoaded}
              refreshToken={statusRefreshToken}
            />

            <div>
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                Provider
              </Text>
              <Segmented
                options={MAIL_PROVIDERS}
                value={selectedProvider}
                onChange={(value) => setSelectedProvider(String(value))}
              />
            </div>

            {selectedProvider === 'gmail' ? (
              <GmailPdfSetup backendUrl={BACKEND_URL} />
            ) : (
              <OutlookPdfSetup backendUrl={BACKEND_URL} onConfigSaved={handleOutlookConfigSaved} />
            )}
          </Space>
        </AppShell>
  )
}
