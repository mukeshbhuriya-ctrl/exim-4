import {
  MinusCircleOutlined,
  PlusOutlined,
  GoogleOutlined,
  WindowsOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
  Divider,
  Input,
  Layout,
  Space,
  Tabs,
  Typography,
  message,
  Row,
  Col,
  Skeleton,
  Badge,
  Tag,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography

const sectionCardStyle = {
  background: '#ffffff',
  borderRadius: 8,
  padding: 24,
  boxShadow: '0 1px 2px rgba(0,0,0,0.03), 0 1px 6px -1px rgba(0,0,0,0.02)',
  borderTop: '4px solid #1677ff',
}

const CONFIGURE_CHA_BASE = '/api/company/admin/configure/cha'

const OTP_PROVIDERS = [
  { value: 'gmail', label: 'Gmail', icon: <GoogleOutlined /> },
  { value: 'outlook', label: 'Outlook', icon: <WindowsOutlined /> },
]

function newSectionId() {
  return `sec-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function emptySection() {
  return { id: newSectionId(), email: '', password: '', gstNumbers: [''] }
}

function sectionFromApi(sec) {
  if (!sec || typeof sec !== 'object') return emptySection()
  const gstList = Array.isArray(sec.gstNumbers) ? sec.gstNumbers : []
  return {
    id: newSectionId(),
    email: String(sec.email ?? sec.userId ?? sec.user_id ?? '').trim(),
    password: String(sec.password ?? ''),
    gstNumbers: gstList.length ? gstList.map((g) => String(g)) : [''],
  }
}

function normalizeChaFromGet(payload) {
  if (!payload || typeof payload !== 'object') return null
  if (payload.cha && typeof payload.cha === 'object') return payload.cha
  return null
}

function ChaCredentialsTab({ backendUrl }) {
  const [loadingList, setLoadingList] = useState(false)
  const [saving, setSaving] = useState(false)
  const [getSuccess, setGetSuccess] = useState(false)
  const [chaRecord, setChaRecord] = useState(null)
  const [isEditing, setIsEditing] = useState(false)
  const [sections, setSections] = useState([emptySection()])

  const fetchCredentials = useCallback(async () => {
    if (!backendUrl) return
    setLoadingList(true)
    try {
      const res = await fetch(`${backendUrl}${CONFIGURE_CHA_BASE}/credential`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load credentials (${res.status})`)
      }
      setGetSuccess(Boolean(data?.success))
      setChaRecord(normalizeChaFromGet(data))
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load CHA credentials')
      setChaRecord(null)
      setGetSuccess(false)
    } finally {
      setLoadingList(false)
    }
  }, [backendUrl])

  useEffect(() => {
    fetchCredentials()
  }, [fetchCredentials])

  const handleEdit = useCallback(() => {
    const apiSections = Array.isArray(chaRecord?.sections) ? chaRecord.sections : []
    setSections(apiSections.length ? apiSections.map(sectionFromApi) : [emptySection()])
    setIsEditing(true)
  }, [chaRecord])

  const handleCancel = useCallback(() => {
    setSections([emptySection()])
    setIsEditing(false)
  }, [])

  const addSection = () => setSections((prev) => [...prev, emptySection()])
  const removeSection = (id) =>
    setSections((prev) => {
      const next = prev.filter((s) => s.id !== id)
      return next.length ? next : [emptySection()]
    })
  const updateSection = (id, patch) =>
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const addGstRow = (sectionId) =>
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, gstNumbers: [...s.gstNumbers, ''] } : s)),
    )
  const removeGstRow = (sectionId, index) =>
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sectionId) return s
        const next = s.gstNumbers.filter((_, i) => i !== index)
        return { ...s, gstNumbers: next.length ? next : [''] }
      }),
    )
  const setGstAt = (sectionId, index, value) =>
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sectionId) return s
        const next = [...s.gstNumbers]
        next[index] = value
        return { ...s, gstNumbers: next }
      }),
    )

  const buildPayloadSections = () =>
    sections
      .map((s) => ({
        email: String(s.email || '').trim(),
        password: String(s.password || ''),
        gstNumbers: s.gstNumbers.map((g) => String(g || '').trim()).filter(Boolean),
      }))
      .filter((s) => s.email && s.password && s.gstNumbers.length)

  const handleSave = async () => {
    if (!backendUrl) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    const payloadSections = buildPayloadSections()
    if (!payloadSections.length) {
      message.warning('Add at least one section with email, password, and at least one GST number.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`${backendUrl}${CONFIGURE_CHA_BASE}/credential`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections: payloadSections }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Save failed (${res.status})`)
      }
      message.success(data?.message || 'Credentials saved.')
      setIsEditing(false)
      await fetchCredentials()
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to save credentials')
    } finally {
      setSaving(false)
    }
  }

  const sectionsFromApi = useMemo(() => {
    if (!chaRecord || !Array.isArray(chaRecord.sections)) return []
    return chaRecord.sections
  }, [chaRecord])

  return (
    <div style={sectionCardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Title level={5} style={{ margin: 0, color: 'var(--exim-gray-800)' }}>
              {isEditing ? 'Configure ICEGATE Credentials' : 'Active ICEGATE Credentials'}
            </Title>
            {!isEditing && getSuccess && (
              <Badge status="success" text="loaded" style={{ padding: '2px 8px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 12, fontSize: 12 }} />
            )}
          </div>
          <Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
            {isEditing 
              ? 'Update ICEGATE login sections and GST numbers.' 
              : 'Current ICEGATE sections for CHA automation.'}
          </Text>
        </div>
        <Space wrap>
          {!isEditing && (
            <Button onClick={fetchCredentials} loading={loadingList}>Reload</Button>
          )}
          {!isEditing && (
            <Button type="primary" onClick={handleEdit}>Modify Configuration</Button>
          )}
        </Space>
      </div>

      {loadingList ? (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Skeleton active paragraph={{ rows: 2 }} />
          <Skeleton active paragraph={{ rows: 2 }} />
        </Space>
      ) : !isEditing ? (
        sectionsFromApi.length ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {sectionsFromApi.map((sec, idx) => {
              const gstList = Array.isArray(sec.gstNumbers) ? sec.gstNumbers : []
              return (
                <div key={`section-${idx}`} style={{ padding: 16, background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8 }}>
                   <Title level={5} style={{ marginTop: 0, marginBottom: 16, fontSize: 14 }}>Section {idx + 1}</Title>
                   <Row gutter={[24, 24]}>
                     <Col xs={24} md={12}>
                        <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>USER ID / EMAIL</Text>
                        <Text strong copyable>{sec.email ?? sec.userId ?? sec.user_id ?? '—'}</Text>
                     </Col>
                     <Col xs={24} md={12}>
                        <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>PASSWORD</Text>
                        <Text strong>{sec.password ? '••••••••••••' : '—'}</Text>
                     </Col>
                     <Col span={24}>
                        <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>GST NUMBERS</Text>
                        {gstList.length ? (
                          <Space wrap>
                            {gstList.map((g, i) => (
                              <Text strong key={`gst-${idx}-${i}`} copyable>{String(g)}</Text>
                            ))}
                          </Space>
                        ) : (
                          <Text strong>—</Text>
                        )}
                     </Col>
                   </Row>
                </div>
              )
            })}
          </Space>
        ) : (
          <div style={{ padding: '24px', textAlign: 'center', background: '#fafafa', border: '1px dashed #d9d9d9', borderRadius: 8 }}>
            <Text type="secondary">No CHA credentials configured yet.</Text>
          </div>
        )
      ) : (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {sections.map((section, sectionIndex) => (
            <div key={section.id} style={{ padding: 16, background: '#fafafa', border: '1px solid #d9d9d9', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Title level={5} style={{ margin: 0, fontSize: 14 }}>Section {sectionIndex + 1}</Title>
                {sections.length > 1 && (
                  <Button type="text" danger size="small" onClick={() => removeSection(section.id)}>Remove Section</Button>
                )}
              </div>
              <Row gutter={[16, 16]}>
                <Col xs={24} md={12}>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>User ID / Email</Text>
                  <Input value={section.email} onChange={(e) => updateSection(section.id, { email: e.target.value })} placeholder="ICEGATE user ID or email" />
                </Col>
                <Col xs={24} md={12}>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Password</Text>
                  <Input.Password value={section.password} onChange={(e) => updateSection(section.id, { password: e.target.value })} placeholder="Password" />
                </Col>
                <Col span={24}>
                  <Divider orientation="left" style={{ margin: 0, fontSize: 13 }}>GST Numbers</Divider>
                </Col>
                <Col span={24}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {section.gstNumbers.map((gst, gi) => (
                      <Space key={`${section.id}-gst-${gi}`} align="baseline" style={{ display: 'flex' }}>
                        <Input style={{ minWidth: 280 }} value={gst} onChange={(e) => setGstAt(section.id, gi, e.target.value)} placeholder="15-character GSTIN" />
                        <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => removeGstRow(section.id, gi)} disabled={section.gstNumbers.length <= 1} />
                      </Space>
                    ))}
                    <Button type="dashed" icon={<PlusOutlined />} onClick={() => addGstRow(section.id)} style={{ width: 280 }}>Add GST Number</Button>
                  </Space>
                </Col>
              </Row>
            </div>
          ))}
          <Button type="dashed" block icon={<PlusOutlined />} onClick={addSection}>Add Section</Button>
          <Space wrap style={{ marginTop: 16 }}>
            <Button onClick={handleCancel}>Cancel</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>Save configuration</Button>
            <Button onClick={fetchCredentials} loading={loadingList} disabled={saving}>Reload</Button>
          </Space>
        </Space>
      )}
    </div>
  )
}

function ChaOtpTab({ backendUrl }) {
  const [selectedProvider, setSelectedProvider] = useState('gmail')
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingCredentials, setLoadingCredentials] = useState(false)

  const [labelsName, setLabelsName] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [refreshToken, setRefreshToken] = useState('')
  const [outlookMailboxFolder, setOutlookMailboxFolder] = useState('')
  const [outlookClientId, setOutlookClientId] = useState('')
  const [outlookClientSecret, setOutlookClientSecret] = useState('')
  const [outlookTenantId, setOutlookTenantId] = useState('')
  const [outlookRefreshToken, setOutlookRefreshToken] = useState('')

  const applyCredentialData = useCallback((data) => {
    const otpcred = data?.cha?.otpcred ?? data?.otpcred
    const payload = otpcred?.payload || data?.payload || {}
    setLabelsName(String(payload?.labelsName || payload?.labels_name || payload?.filterName || '').trim())
    setClientId(String(payload?.clientId || payload?.client_id || '').trim())
    setClientSecret(String(payload?.clientSecret || payload?.client_secret || '').trim())
    setRefreshToken(String(payload?.refreshToken || payload?.refresh_token || '').trim())
  }, [])

  const fetchCredentials = useCallback(
    async ({ showError = true } = {}) => {
      if (!backendUrl) return
      setLoadingCredentials(true)
      try {
        const res = await fetch(`${backendUrl}${CONFIGURE_CHA_BASE}/otp/credential`, {
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
    [backendUrl, applyCredentialData],
  )

  useEffect(() => {
    fetchCredentials({ showError: false })
  }, [fetchCredentials])

  const handleSave = async () => {
    if (selectedProvider === 'outlook') {
      message.info('Outlook OTP setup is not available yet. This form is a placeholder.')
      return
    }
    if (!backendUrl) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!clientId.trim() || !clientSecret.trim() || !refreshToken.trim()) {
      message.error('Client ID, Client Secret, and Refresh Token are required.')
      return
    }
    setSaving(true)
    try {
      const body = {
        provider: selectedProvider,
        labelsName: labelsName.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        refreshToken: refreshToken.trim(),
      }
      const res = await fetch(`${backendUrl}${CONFIGURE_CHA_BASE}/otp/credential`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Save OTP setup failed (${res.status})`)
      }
      applyCredentialData({ otpcred: { payload: body } })
      message.success(data?.message || 'OTP setup saved successfully.')
      setIsEditing(false)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to save OTP setup')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setIsEditing(false)
    fetchCredentials({ showError: false })
  }

  const renderGmailContent = () => (
    <div style={sectionCardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <Title level={5} style={{ margin: 0, color: 'var(--exim-gray-800)' }}>
            {isEditing ? 'Configure Gmail OTP Settings' : 'Active Gmail OTP Configuration'}
          </Title>
          <Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
            {isEditing 
              ? 'Update OAuth app credentials below.' 
              : 'Current OAuth details for the Gmail OTP mailbox.'}
          </Text>
        </div>
        <Space wrap>
          {!isEditing && (
            <Button onClick={() => fetchCredentials({ showError: true })} loading={loadingCredentials}>Reload</Button>
          )}
          {!isEditing && (
            <Button type="primary" onClick={() => setIsEditing(true)}>Modify Configuration</Button>
          )}
        </Space>
      </div>

      {loadingCredentials && !isEditing ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : !isEditing ? (
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Divider orientation="left" style={{ margin: 0, fontSize: 14 }}>OAuth Setup</Divider>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>CLIENT ID</Text>
            <Text strong copyable={!!clientId}>{clientId || '—'}</Text>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>CLIENT SECRET</Text>
            <Text strong>{clientSecret ? '••••••••••••' : '—'}</Text>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>REFRESH TOKEN</Text>
            <Text strong>{refreshToken ? '••••••••••••' : '—'}</Text>
          </Col>
          <Col span={24}>
            <Divider orientation="left" style={{ marginTop: 8, marginBottom: 0, fontSize: 14 }}>Label Mapping</Divider>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>LABEL / FOLDER NAME</Text>
            <Text strong>{labelsName || '—'}</Text>
          </Col>
        </Row>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Row gutter={[24, 24]}>
            <Col span={24}>
              <Divider orientation="left" style={{ margin: 0, fontSize: 14 }}>OAuth Setup</Divider>
            </Col>
            <Col xs={24} md={12}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Client ID</Text>
              <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="OAuth client ID" />
            </Col>
            <Col xs={24} md={12}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Client Secret</Text>
              <Input.Password value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="OAuth client secret" />
            </Col>
            <Col xs={24} md={12}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Refresh Token</Text>
              <Input.Password value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} placeholder="Refresh token" />
            </Col>
            <Col span={24}>
              <Divider orientation="left" style={{ margin: 0, fontSize: 14 }}>Label Mapping</Divider>
            </Col>
            <Col xs={24} md={12}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Label / folder name</Text>
              <Input value={labelsName} onChange={(e) => setLabelsName(e.target.value)} placeholder="labelsName" />
            </Col>
          </Row>
          <Space wrap style={{ marginTop: 16 }}>
            <Button onClick={handleCancel}>Cancel</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>Save configuration</Button>
            <Button onClick={() => fetchCredentials({ showError: true })} loading={loadingCredentials} disabled={saving}>Reload</Button>
          </Space>
        </Space>
      )}
    </div>
  )

  const renderOutlookContent = () => (
    <div style={sectionCardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <Title level={5} style={{ margin: 0, color: 'var(--exim-gray-800)' }}>
            {isEditing ? 'Configure Outlook OTP Settings' : 'Active Outlook OTP Configuration'}
          </Title>
          <Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
            {isEditing 
              ? 'Update Microsoft Graph app credentials below.' 
              : 'Current Graph app details for the Outlook OTP mailbox.'}
          </Text>
        </div>
        <Space wrap>
          {!isEditing && (
            <Button onClick={() => fetchCredentials({ showError: true })} loading={loadingCredentials}>Reload</Button>
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
            <Text strong style={{ fontSize: 13, display: 'block', color: '#0958d9' }}>Outlook OTP (preview)</Text>
            <Text style={{ fontSize: 13, color: '#1677ff' }}>Outlook integration is not wired to the backend yet. Use the form below as a placeholder.</Text>
          </div>
        </div>
      )}

      {!isEditing ? (
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Divider orientation="left" style={{ margin: 0, fontSize: 14 }}>Application Setup</Divider>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>TENANT ID</Text>
            <Text strong copyable={!!outlookTenantId}>{outlookTenantId || '—'}</Text>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>CLIENT ID</Text>
            <Text strong copyable={!!outlookClientId}>{outlookClientId || '—'}</Text>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>CLIENT SECRET</Text>
            <Text strong>{outlookClientSecret ? '••••••••••••' : '—'}</Text>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>REFRESH TOKEN</Text>
            <Text strong>{outlookRefreshToken ? '••••••••••••' : '—'}</Text>
          </Col>
          <Col span={24}>
            <Divider orientation="left" style={{ marginTop: 8, marginBottom: 0, fontSize: 14 }}>Mailbox Mapping</Divider>
          </Col>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>MAILBOX FOLDER</Text>
            <Text strong>{outlookMailboxFolder || '—'}</Text>
          </Col>
        </Row>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Row gutter={[24, 24]}>
            <Col span={24}>
              <Divider orientation="left" style={{ margin: 0, fontSize: 14 }}>Application Setup</Divider>
            </Col>
            <Col xs={24} md={12}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Tenant ID</Text>
              <Input value={outlookTenantId} onChange={(e) => setOutlookTenantId(e.target.value)} placeholder="Azure directory (tenant) ID" />
            </Col>
            <Col xs={24} md={12}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Client ID</Text>
              <Input value={outlookClientId} onChange={(e) => setOutlookClientId(e.target.value)} placeholder="Azure app client ID" />
            </Col>
            <Col xs={24} md={12}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Client Secret</Text>
              <Input.Password value={outlookClientSecret} onChange={(e) => setOutlookClientSecret(e.target.value)} placeholder="Azure client secret" />
            </Col>
            <Col xs={24} md={12}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Refresh Token</Text>
              <Input.Password value={outlookRefreshToken} onChange={(e) => setOutlookRefreshToken(e.target.value)} placeholder="Refresh token" />
            </Col>
            <Col span={24}>
              <Divider orientation="left" style={{ margin: 0, fontSize: 14 }}>Mailbox Mapping</Divider>
            </Col>
            <Col xs={24} md={12}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Mailbox folder</Text>
              <Input value={outlookMailboxFolder} onChange={(e) => setOutlookMailboxFolder(e.target.value)} placeholder="Inbox/OTP" />
            </Col>
          </Row>
          <Space wrap style={{ marginTop: 16 }}>
            <Button onClick={handleCancel}>Cancel</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>Save (preview)</Button>
            <Button onClick={() => fetchCredentials({ showError: true })} loading={loadingCredentials} disabled={saving}>Reload</Button>
          </Space>
        </Space>
      )}
    </div>
  )

  return (
    <div>
      <Tabs
        activeKey={selectedProvider}
        onChange={(key) => setSelectedProvider(key)}
        size="large"
        items={OTP_PROVIDERS.map((provider) => ({
          key: provider.value,
          label: provider.label,
          icon: provider.icon,
          children: provider.value === 'gmail' ? renderGmailContent() : renderOutlookContent()
        }))}
      />
    </div>
  )
}

function ChaPasswordAlertTab({ backendUrl }) {
  const [emails, setEmails] = useState([''])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  const fetchEmails = useCallback(async () => {
    if (!backendUrl) return
    setLoading(true)
    try {
      const res = await fetch(`${backendUrl}${CONFIGURE_CHA_BASE}/password-alert-emails`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load alert emails (${res.status})`)
      }
      const list = Array.isArray(data.emails) ? data.emails : []
      setEmails(list.length ? list : [''])
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load alert emails')
      setEmails([''])
    } finally {
      setLoading(false)
    }
  }, [backendUrl])

  useEffect(() => {
    fetchEmails()
  }, [fetchEmails])

  const handleEdit = useCallback(() => {
    setIsEditing(true)
  }, [])

  const handleCancel = useCallback(() => {
    setIsEditing(false)
    fetchEmails()
  }, [fetchEmails])

  const addEmailRow = () => setEmails((prev) => [...prev, ''])
  const removeEmailRow = (index) =>
    setEmails((prev) => {
      const next = prev.filter((_, i) => i !== index)
      return next.length ? next : ['']
    })
  const setEmailAt = (index, value) =>
    setEmails((prev) => prev.map((item, i) => (i === index ? value : item)))

  const handleSave = async () => {
    if (!backendUrl) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    const list = [...new Set(emails.map((e) => String(e || '').trim()).filter(Boolean))]
    setSaving(true)
    try {
      const res = await fetch(`${backendUrl}${CONFIGURE_CHA_BASE}/password-alert-emails`, {
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
      setEmails(saved.length ? saved : [''])
      message.success(data?.message || 'Password alert emails saved.')
      setIsEditing(false)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to save alert emails')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={sectionCardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <Title level={5} style={{ margin: 0, color: 'var(--exim-gray-800)' }}>
            {isEditing ? 'Configure Password Alerts' : 'Active Password Alerts'}
          </Title>
          <Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
            {isEditing 
              ? 'Update the email addresses that receive failed login alerts.' 
              : 'When CHA / ICEGATE login fails due to a wrong password, an alert is sent to these addresses.'}
          </Text>
        </div>
        <Space wrap>
          {!isEditing && (
            <Button onClick={fetchEmails} loading={loading}>Reload</Button>
          )}
          {!isEditing && (
            <Button type="primary" onClick={handleEdit}>Modify Configuration</Button>
          )}
        </Space>
      </div>

      {loading && !isEditing ? (
        <Skeleton active paragraph={{ rows: 2 }} />
      ) : !isEditing ? (
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>ALERT EMAILS</Text>
            {emails.length && emails[0] !== '' ? (
              <Space wrap>
                {emails.filter(e => e.trim()).map((email, idx) => (
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
          {emails.map((email, index) => (
            <Space key={`cha-alert-email-${index}`} align="baseline" style={{ display: 'flex', width: '100%' }}>
              <Input
                value={email}
                onChange={(e) => setEmailAt(index, e.target.value)}
                placeholder="alert@company.com"
                style={{ width: 320 }}
              />
              <Button
                type="text"
                danger
                icon={<MinusCircleOutlined />}
                onClick={() => removeEmailRow(index)}
                disabled={emails.length <= 1}
              />
            </Space>
          ))}
          <Button type="dashed" icon={<PlusOutlined />} onClick={addEmailRow} style={{ width: 320 }}>
            Add Email
          </Button>
          <Space wrap style={{ marginTop: 16 }}>
            <Button onClick={handleCancel}>Cancel</Button>
            <Button type="primary" onClick={handleSave} loading={saving}>Save alert emails</Button>
            <Button onClick={fetchEmails} loading={loading} disabled={saving}>Reload</Button>
          </Space>
        </Space>
      )}
    </div>
  )
}

export default function CompanyAdminConfigureChaPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const tabItems = [
    {
      key: 'credentials',
      label: 'ICEGATE Credentials',
      children: <ChaCredentialsTab backendUrl={BACKEND_URL} />,
    },
    {
      key: 'otp',
      label: 'OTP Configuration',
      children: <ChaOtpTab backendUrl={BACKEND_URL} />,
    },
    {
      key: 'password-alerts',
      label: 'Password Alerts',
      children: <ChaPasswordAlertTab backendUrl={BACKEND_URL} />,
    },
  ]

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <PageHeader 
        title="CHA Setup" 
        description="Configure ICEGATE logins and OTP provider settings for Custom House Agent process automation."
      />
      <div style={{ padding: '0 24px 24px 24px' }}>
        <Tabs items={tabItems} size="large" />
      </div>
    </AppShell>
  )
}
