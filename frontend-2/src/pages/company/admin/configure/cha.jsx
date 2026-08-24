import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Input,
  Layout,
  Modal,
  Segmented,
  Space,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content, Sider } = Layout
const { Title, Text } = Typography

const CONFIGURE_CHA_BASE = '/api/company/admin/configure/cha'

const OTP_PROVIDERS = [
  { value: 'gmail', label: 'Gmail' },
  { value: 'outlook', label: 'Outlook' },
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
  const [chaRecord, setChaRecord] = useState(null)
  const [getSuccess, setGetSuccess] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [sections, setSections] = useState([emptySection()])

  const resetModal = useCallback(() => {
    setSections([emptySection()])
    setIsEditMode(false)
    setModalOpen(false)
  }, [])

  const openAddModal = useCallback(() => {
    setSections([emptySection()])
    setIsEditMode(false)
    setModalOpen(true)
  }, [])

  const openEditModal = useCallback(() => {
    const apiSections = Array.isArray(chaRecord?.sections) ? chaRecord.sections : []
    setSections(apiSections.length ? apiSections.map(sectionFromApi) : [emptySection()])
    setIsEditMode(true)
    setModalOpen(true)
  }, [chaRecord])

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
      resetModal()
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
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Text type="secondary">ICEGATE login sections and GST numbers for CHA automation.</Text>
      <Space wrap>
        {sectionsFromApi.length ? (
          <Button type="primary" onClick={openEditModal}>
            Edit credentials
          </Button>
        ) : (
          <Button type="primary" onClick={openAddModal}>
            Add credentials
          </Button>
        )}
        <Button onClick={fetchCredentials} loading={loadingList}>
          Refresh
        </Button>
      </Space>
      <div>
        <Space align="center" style={{ marginBottom: 12 }}>
          <Title level={5} style={{ margin: 0 }}>
            Sections
          </Title>
          {getSuccess ? <Tag color="success">loaded</Tag> : null}
        </Space>
        {loadingList ? (
          <Text type="secondary">Loading…</Text>
        ) : chaRecord ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {sectionsFromApi.length ? (
              sectionsFromApi.map((sec, idx) => {
                const gstList = Array.isArray(sec.gstNumbers) ? sec.gstNumbers : []
                return (
                  <Card key={`section-${idx}`} size="small" title={`Section ${idx + 1}`} style={{ maxWidth: 720 }}>
                    <Descriptions bordered size="small" column={1}>
                      <Descriptions.Item label="User ID / Email">
                        {sec.email ?? sec.userId ?? sec.user_id ?? '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label="Password">
                        {sec.password != null ? (
                          <Text code copyable>
                            {String(sec.password)}
                          </Text>
                        ) : (
                          '—'
                        )}
                      </Descriptions.Item>
                      <Descriptions.Item label="GST numbers">
                        {gstList.length ? (
                          <Space wrap>
                            {gstList.map((g, i) => (
                              <Tag key={`gst-${idx}-${i}`}>{String(g)}</Tag>
                            ))}
                          </Space>
                        ) : (
                          '—'
                        )}
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>
                )
              })
            ) : (
              <Text type="secondary">No sections on this record.</Text>
            )}
          </Space>
        ) : (
          <Text type="secondary">No CHA credentials yet.</Text>
        )}
      </div>

      <Modal
        title={isEditMode ? 'Edit CHA credentials' : 'Add CHA credentials'}
        open={modalOpen}
        onCancel={resetModal}
        width={720}
        okText="Save"
        confirmLoading={saving}
        onOk={handleSave}
        destroyOnClose
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {isEditMode ? (
            <Alert
              type="info"
              showIcon
              message="Existing credentials are pre-filled. Update fields and save to apply changes."
            />
          ) : null}
          {sections.map((section, sectionIndex) => (
            <Card
              key={section.id}
              size="small"
              title={`Section ${sectionIndex + 1}`}
              extra={
                sections.length > 1 ? (
                  <Button type="link" danger size="small" onClick={() => removeSection(section.id)}>
                    Remove section
                  </Button>
                ) : null
              }
            >
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                    User ID / Email
                  </Text>
                  <Input
                    value={section.email}
                    onChange={(e) => updateSection(section.id, { email: e.target.value })}
                    placeholder="ICEGATE user ID or email"
                  />
                </div>
                <Input.Password
                  value={section.password}
                  onChange={(e) => updateSection(section.id, { password: e.target.value })}
                  placeholder="Password"
                />
                <Divider orientationMargin={0} plain>
                  GST numbers
                </Divider>
                {section.gstNumbers.map((gst, gi) => (
                  <Space key={`${section.id}-gst-${gi}`} align="baseline">
                    <Input
                      style={{ minWidth: 200 }}
                      value={gst}
                      onChange={(e) => setGstAt(section.id, gi, e.target.value)}
                      placeholder="15-character GSTIN"
                    />
                    <Button
                      type="text"
                      danger
                      icon={<MinusCircleOutlined />}
                      onClick={() => removeGstRow(section.id, gi)}
                      disabled={section.gstNumbers.length <= 1}
                    />
                  </Space>
                ))}
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => addGstRow(section.id)}>
                  Add GST number
                </Button>
              </Space>
            </Card>
          ))}
          <Button type="dashed" block icon={<PlusOutlined />} onClick={addSection}>
            Add section
          </Button>
        </Space>
      </Modal>
    </Space>
  )
}

function GmailOtpFields({ labelsName, clientId, clientSecret, refreshToken, onChange, readOnly = false }) {
  return (
    <Space direction="vertical" size="small" style={{ width: '100%', maxWidth: 480 }}>
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
          Label / folder name
        </Text>
        <Input
          value={labelsName}
          onChange={(e) => onChange?.('labelsName', e.target.value)}
          placeholder="labelsName"
          readOnly={readOnly}
        />
      </div>
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
          Client ID
        </Text>
        <Input
          value={clientId}
          onChange={(e) => onChange?.('clientId', e.target.value)}
          placeholder="OAuth client ID"
          readOnly={readOnly}
        />
      </div>
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
          Client Secret
        </Text>
        <Input.Password
          value={clientSecret}
          onChange={(e) => onChange?.('clientSecret', e.target.value)}
          placeholder="OAuth client secret"
          readOnly={readOnly}
        />
      </div>
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
          Refresh Token
        </Text>
        <Input.Password
          value={refreshToken}
          onChange={(e) => onChange?.('refreshToken', e.target.value)}
          placeholder="Refresh token"
          readOnly={readOnly}
        />
      </div>
    </Space>
  )
}

function OutlookOtpFields({ mailboxFolder, clientId, clientSecret, tenantId, refreshToken, onChange, readOnly = false }) {
  return (
    <Space direction="vertical" size="small" style={{ width: '100%', maxWidth: 480 }}>
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
          Mailbox folder
        </Text>
        <Input
          value={mailboxFolder}
          onChange={(e) => onChange?.('mailboxFolder', e.target.value)}
          placeholder="Inbox/OTP"
          readOnly={readOnly}
        />
      </div>
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
          Application (client) ID
        </Text>
        <Input
          value={clientId}
          onChange={(e) => onChange?.('clientId', e.target.value)}
          placeholder="Azure app client ID"
          readOnly={readOnly}
        />
      </div>
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
          Client Secret
        </Text>
        <Input.Password
          value={clientSecret}
          onChange={(e) => onChange?.('clientSecret', e.target.value)}
          placeholder="Azure client secret"
          readOnly={readOnly}
        />
      </div>
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
          Tenant ID
        </Text>
        <Input
          value={tenantId}
          onChange={(e) => onChange?.('tenantId', e.target.value)}
          placeholder="Azure directory (tenant) ID"
          readOnly={readOnly}
        />
      </div>
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
          Refresh Token
        </Text>
        <Input.Password
          value={refreshToken}
          onChange={(e) => onChange?.('refreshToken', e.target.value)}
          placeholder="Refresh token"
          readOnly={readOnly}
        />
      </div>
    </Space>
  )
}

function ChaOtpTab({ backendUrl }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingCredentials, setLoadingCredentials] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('gmail')
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
    setLabelsName(
      String(payload?.labelsName || payload?.labels_name || payload?.filterName || '').trim(),
    )
    setClientId(String(payload?.clientId || payload?.client_id || '').trim())
    setClientSecret(String(payload?.clientSecret || payload?.client_secret || '').trim())
    setRefreshToken(String(payload?.refreshToken || payload?.refresh_token || '').trim())
  }, [])

  const handleGmailFieldChange = (field, value) => {
    if (field === 'labelsName') setLabelsName(value)
    if (field === 'clientId') setClientId(value)
    if (field === 'clientSecret') setClientSecret(value)
    if (field === 'refreshToken') setRefreshToken(value)
  }

  const handleOutlookFieldChange = (field, value) => {
    if (field === 'mailboxFolder') setOutlookMailboxFolder(value)
    if (field === 'clientId') setOutlookClientId(value)
    if (field === 'clientSecret') setOutlookClientSecret(value)
    if (field === 'tenantId') setOutlookTenantId(value)
    if (field === 'refreshToken') setOutlookRefreshToken(value)
  }

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

  const openModal = useCallback(async () => {
    setModalOpen(true)
    if (selectedProvider === 'gmail') {
      await fetchCredentials()
    }
  }, [fetchCredentials, selectedProvider])

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
      setModalOpen(false)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to save OTP setup')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    fetchCredentials({ showError: false })
  }, [fetchCredentials])

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Text type="secondary">OTP provider settings for CHA ICEGATE login.</Text>

      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          Provider
        </Text>
        <Segmented
          options={OTP_PROVIDERS}
          value={selectedProvider}
          onChange={(value) => setSelectedProvider(String(value))}
        />
      </div>

      {selectedProvider === 'gmail' ? (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Text strong>Current Gmail OTP settings</Text>
          <GmailOtpFields
            labelsName={labelsName}
            clientId={clientId}
            clientSecret={clientSecret}
            refreshToken={refreshToken}
            readOnly
          />
          <Button type="primary" onClick={openModal} loading={loadingCredentials}>
            Setup OTP
          </Button>
        </Space>
      ) : (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Outlook OTP (preview)"
            description="Outlook integration is not wired to the backend yet. Use the form below as a placeholder."
          />
          <Text strong>Outlook OTP settings</Text>
          <OutlookOtpFields
            mailboxFolder={outlookMailboxFolder}
            clientId={outlookClientId}
            clientSecret={outlookClientSecret}
            tenantId={outlookTenantId}
            refreshToken={outlookRefreshToken}
            onChange={handleOutlookFieldChange}
          />
          <Button type="primary" onClick={openModal}>
            Setup OTP
          </Button>
        </Space>
      )}

      <Modal
        title="Setup OTP"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText={selectedProvider === 'outlook' ? 'Save (preview)' : 'Save'}
        confirmLoading={saving}
        width={560}
        destroyOnClose
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              Provider
            </Text>
            <Segmented
              options={OTP_PROVIDERS}
              value={selectedProvider}
              onChange={(value) => setSelectedProvider(String(value))}
            />
          </div>

          {selectedProvider === 'gmail' ? (
            <GmailOtpFields
              labelsName={labelsName}
              clientId={clientId}
              clientSecret={clientSecret}
              refreshToken={refreshToken}
              onChange={handleGmailFieldChange}
            />
          ) : (
            <>
              <Alert type="warning" showIcon message="Outlook save is not enabled yet." />
              <OutlookOtpFields
                mailboxFolder={outlookMailboxFolder}
                clientId={outlookClientId}
                clientSecret={outlookClientSecret}
                tenantId={outlookTenantId}
                refreshToken={outlookRefreshToken}
                onChange={handleOutlookFieldChange}
              />
            </>
          )}
        </Space>
      </Modal>
    </Space>
  )
}

function ChaPasswordAlertTab({ backendUrl }) {
  const [emails, setEmails] = useState([''])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

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
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to save alert emails')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Text type="secondary">
        Add one or more email addresses. When CHA / ICEGATE login fails due to a wrong password, an
        alert is sent to these addresses.
      </Text>
      {loading ? (
        <Text type="secondary">Loading alert emails…</Text>
      ) : (
        <Space direction="vertical" size="small" style={{ width: '100%', maxWidth: 520 }}>
          {emails.map((email, index) => (
            <Space key={`cha-alert-email-${index}`} align="baseline" style={{ width: '100%' }}>
              <Input
                value={email}
                onChange={(e) => setEmailAt(index, e.target.value)}
                placeholder="alert@company.com"
                style={{ minWidth: 280 }}
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
          <Button type="dashed" block icon={<PlusOutlined />} onClick={addEmailRow}>
            Add email
          </Button>
          <Space wrap>
            <Button type="primary" onClick={handleSave} loading={saving}>
              Save alert emails
            </Button>
            <Button onClick={fetchEmails} loading={loading}>
              Reload
            </Button>
          </Space>
        </Space>
      )}
    </Space>
  )
}

export default function CompanyAdminConfigureChaPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const tabItems = [
    {
      key: 'credentials',
      label: 'ICEGATE credentials',
      children: <ChaCredentialsTab backendUrl={BACKEND_URL} />,
    },
    {
      key: 'otp',
      label: 'OTP',
      children: <ChaOtpTab backendUrl={BACKEND_URL} />,
    },
    {
      key: 'password-alerts',
      label: 'Password alerts',
      children: <ChaPasswordAlertTab backendUrl={BACKEND_URL} />,
    },
  ]

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                CHA setup
              </Title>
              <Text type="secondary">ICEGATE logins and OTP provider settings for CHA process automation.</Text>
            </div>
            <Tabs items={tabItems} />
          </Space>
        </AppShell>
  )
}
