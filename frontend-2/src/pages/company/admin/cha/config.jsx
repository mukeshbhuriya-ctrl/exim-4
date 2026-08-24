import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Card, Descriptions, Divider, Input, Layout, Modal, Space, Tag, Typography, message } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography

function newSectionId() {
  return `sec-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function emptySection() {
  return {
    id: newSectionId(),
    email: '',
    password: '',
    gstNumbers: [''],
  }
}

/** GET shape: { success, cha: { id, companyId, sections[], createdAt, updatedAt } } */
function normalizeChaFromGet(payload) {
  if (!payload || typeof payload !== 'object') return null
  if (payload.cha && typeof payload.cha === 'object') return payload.cha
  if (payload.data && typeof payload.data === 'object' && payload.data.cha) return payload.data.cha
  return null
}

export default function CompanyAdminChaConfigPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [loadingList, setLoadingList] = useState(false)
  const [saving, setSaving] = useState(false)
  const [chaRecord, setChaRecord] = useState(null)
  const [getSuccess, setGetSuccess] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [sections, setSections] = useState([emptySection()])

  const resetModal = useCallback(() => {
    setSections([emptySection()])
    setModalOpen(false)
  }, [])

  const fetchCredentials = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoadingList(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/cha/credential/`, {
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
  }, [BACKEND_URL])

  useEffect(() => {
    fetchCredentials()
  }, [fetchCredentials])

  const addSection = useCallback(() => {
    setSections((prev) => [...prev, emptySection()])
  }, [])

  const removeSection = useCallback((id) => {
    setSections((prev) => {
      const next = prev.filter((s) => s.id !== id)
      return next.length ? next : [emptySection()]
    })
  }, [])

  const updateSection = useCallback((id, patch) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const addGstRow = useCallback((sectionId) => {
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, gstNumbers: [...s.gstNumbers, ''] } : s)),
    )
  }, [])

  const removeGstRow = useCallback((sectionId, index) => {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sectionId) return s
        const next = s.gstNumbers.filter((_, i) => i !== index)
        return { ...s, gstNumbers: next.length ? next : [''] }
      }),
    )
  }, [])

  const setGstAt = useCallback((sectionId, index, value) => {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sectionId) return s
        const next = [...s.gstNumbers]
        next[index] = value
        return { ...s, gstNumbers: next }
      }),
    )
  }, [])

  const buildPayloadSections = useCallback(() => {
    return sections
      .map((s) => ({
        email: String(s.email || '').trim(),
        password: String(s.password || ''),
        gstNumbers: s.gstNumbers.map((g) => String(g || '').trim()).filter(Boolean),
      }))
      .filter((s) => s.email && s.password && s.gstNumbers.length)
  }, [sections])

  const handleSave = useCallback(async () => {
    if (!BACKEND_URL) {
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
      const res = await fetch(`${BACKEND_URL}/api/company/admin/cha/credential/`, {
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
  }, [BACKEND_URL, buildPayloadSections, fetchCredentials, resetModal])

  const sectionsFromApi = useMemo(() => {
    if (!chaRecord || !Array.isArray(chaRecord.sections)) return []
    return chaRecord.sections
  }, [chaRecord])

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                CHA credentials
              </Title>
              <Text type="secondary">Manage CHA login sections and GST numbers.</Text>
            </div>

            <Space wrap>
              <Button type="primary" onClick={() => setModalOpen(true)}>
                Add credentials
              </Button>
              <Button onClick={fetchCredentials} loading={loadingList}>
                Refresh
              </Button>
            </Space>

            <div>
              <Space align="center" style={{ marginBottom: 12 }}>
                <Title level={5} style={{ margin: 0 }}>
                  Sections
                </Title>
                {getSuccess ? <Tag color="success">success</Tag> : null}
              </Space>
              {loadingList ? (
                <Text type="secondary">Loading…</Text>
              ) : chaRecord ? (
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  {sectionsFromApi.length ? (
                    sectionsFromApi.map((sec, idx) => {
                      const gstList = Array.isArray(sec.gstNumbers)
                        ? sec.gstNumbers
                        : sec.gst_numbers
                          ? Array.isArray(sec.gst_numbers)
                            ? sec.gst_numbers
                            : [sec.gst_numbers]
                          : []
                      return (
                        <Card key={`section-${idx}`} size="small" title={`Section ${idx + 1}`} style={{ maxWidth: 720 }}>
                          <Descriptions bordered size="small" column={1}>
                            <Descriptions.Item label="email">
                              {sec.email != null ? String(sec.email) : '—'}
                            </Descriptions.Item>
                            <Descriptions.Item label="password">
                              {sec.password != null ? (
                                <Text code copyable>
                                  {String(sec.password)}
                                </Text>
                              ) : (
                                '—'
                              )}
                            </Descriptions.Item>
                            <Descriptions.Item label="gstNumbers">
                              {gstList.length ? (
                                <Space wrap>
                                  {gstList.map((g, i) => (
                                    <Tag key={`gst-${idx}-${i}`}>{String(g)}</Tag>
                                  ))}
                                </Space>
                              ) : (
                                <Text type="secondary">—</Text>
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
                <Text type="secondary">No CHA credentials yet. Use Add credentials to create them.</Text>
              )}
            </div>
          </Space>
        

      <Modal
        title="Add CHA credentials"
        open={modalOpen}
        onCancel={resetModal}
        width={720}
        okText="Save"
        confirmLoading={saving}
        onOk={handleSave}
        destroyOnClose
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
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
                    Email
                  </Text>
                  <Input
                    value={section.email}
                    onChange={(e) => updateSection(section.id, { email: e.target.value })}
                    placeholder="email@example.com"
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                    Password
                  </Text>
                  <Input.Password
                    value={section.password}
                    onChange={(e) => updateSection(section.id, { password: e.target.value })}
                    placeholder="Password"
                  />
                </div>
                <Divider orientationMargin={0} plain>
                  GST numbers
                </Divider>
                {section.gstNumbers.map((gst, gi) => (
                  <Space key={`${section.id}-gst-${gi}`} style={{ width: '100%' }} align="baseline">
                    <Input
                      style={{ flex: 1, minWidth: 200 }}
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
    </AppShell>
  )
}
