import { Button, Input, Layout, Space, Tag, Typography, message, Row, Col } from 'antd'
import { useCallback, useEffect, useState } from 'react'
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

const CONFIGURE_SALES_BASE = '/api/company/admin/configure/sales'

function extractSapFromResponse(data) {
  if (!data || typeof data !== 'object') return null
  const sap =
    data.sales?.sap && typeof data.sales.sap === 'object'
      ? data.sales.sap
      : data.sap && typeof data.sap === 'object'
        ? data.sap
        : null
  if (!sap) return null
  return sap
}

export default function CompanyAdminConfigureSalesPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [sapConnection, setSapConnection] = useState('')
  const [reportTcode, setReportTcode] = useState('')
  const [uploadTcode, setUploadTcode] = useState('')
  const [configured, setConfigured] = useState(null)
  
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  // Draft states to allow canceling edits safely
  const [draftUserId, setDraftUserId] = useState('')
  const [draftPassword, setDraftPassword] = useState('')
  const [draftSapConnection, setDraftSapConnection] = useState('')
  const [draftReportTcode, setDraftReportTcode] = useState('')
  const [draftUploadTcode, setDraftUploadTcode] = useState('')

  const loadCredentials = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}${CONFIGURE_SALES_BASE}/credential`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load credentials (${res.status})`)
      }

      const sap = extractSapFromResponse(data)
      const id = String(sap?.id ?? sap?.username ?? sap?.userId ?? sap?.sapId ?? '').trim()
      const pw = sap?.password != null ? String(sap.password) : ''
      const conn = String(
        sap?.sapConnection ?? sap?.SAP_CONNECTION ?? sap?.connection ?? '',
      ).trim()
      const tcode = String(sap?.reportTcode ?? sap?.REPORT_TCODE ?? '').trim()
      const upload = String(sap?.uploadTcode ?? sap?.UPLOAD_TCODE ?? '').trim()
      
      setUserId(id)
      setPassword(pw)
      setSapConnection(conn)
      setReportTcode(tcode)
      setUploadTcode(upload)
      setConfigured(Boolean(data?.configured ?? sap?.configured))
      
      if (!id && !pw && !conn && !tcode && !upload) {
        message.info('No SAP credentials stored yet.')
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load SAP credentials')
      setConfigured(false)
    } finally {
      setLoading(false)
    }
  }, [BACKEND_URL])

  const handleEdit = () => {
    setDraftUserId(userId)
    setDraftPassword(password)
    setDraftSapConnection(sapConnection)
    setDraftReportTcode(reportTcode)
    setDraftUploadTcode(uploadTcode)
    setIsEditing(true)
  }

  const handleCancel = () => {
    setIsEditing(false)
  }

  const handleSave = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    const id = draftUserId.trim()
    const conn = draftSapConnection.trim()
    const tcode = draftReportTcode.trim()
    const upload = draftUploadTcode.trim()
    if (!id || !draftPassword || !conn || !tcode || !upload) {
      message.error('SAP user ID, password, SAP connection, SALES TCODE, and JV UPLOAD TCODE are required.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`${BACKEND_URL}${CONFIGURE_SALES_BASE}/credential`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          password: draftPassword,
          sapConnection: conn,
          SAP_CONNECTION: conn,
          connection: conn,
          reportTcode: tcode,
          REPORT_TCODE: tcode,
          uploadTcode: upload,
          UPLOAD_TCODE: upload,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Save failed (${res.status})`)
      }
      if (data?.success === false) {
        message.warning(data?.message || 'Save reported failure')
      } else {
        message.success(data?.message || 'SAP credentials saved.')
      }

      const sap = extractSapFromResponse(data)
      if (sap) {
        const savedId = String(sap.id ?? sap.username ?? id).trim()
        if (savedId) setUserId(savedId)
        if (sap.password != null) setPassword(String(sap.password))
        const savedConn = String(
          sap.sapConnection ?? sap.SAP_CONNECTION ?? sap.connection ?? conn,
        ).trim()
        if (savedConn) setSapConnection(savedConn)
        const savedTcode = String(sap.reportTcode ?? sap.REPORT_TCODE ?? tcode).trim()
        if (savedTcode) setReportTcode(savedTcode)
        const savedUpload = String(sap.uploadTcode ?? sap.UPLOAD_TCODE ?? upload).trim()
        if (savedUpload) setUploadTcode(savedUpload)
        setConfigured(Boolean(sap.configured ?? data?.configured ?? true))
      } else {
        setConfigured(true)
        setUserId(id)
        setPassword(draftPassword)
        setSapConnection(conn)
        setReportTcode(tcode)
        setUploadTcode(upload)
      }
      setIsEditing(false)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save SAP credentials')
    } finally {
      setSaving(false)
    }
  }, [BACKEND_URL, draftUserId, draftPassword, draftSapConnection, draftReportTcode, draftUploadTcode])

  useEffect(() => {
    loadCredentials()
  }, [loadCredentials])

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <PageHeader
        title="SAP Credentials"
        description="Store SAP login used for automated sales data fetch from SAP."
        actions={
          <Space wrap>
            <Button onClick={loadCredentials} loading={loading} disabled={!BACKEND_URL || isEditing}>
              Reload
            </Button>
            {isEditing ? (
              <>
                <Button onClick={handleCancel}>Cancel</Button>
                <Button type="primary" loading={saving} onClick={handleSave} disabled={!BACKEND_URL}>
                  Save Credentials
                </Button>
              </>
            ) : (
              <Button type="primary" onClick={handleEdit} disabled={loading}>
                Modify Credentials
              </Button>
            )}
          </Space>
        }
      />

      <div style={{ marginTop: 24 }}>
        <div style={sectionCardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <div>
              <Title level={5} style={{ margin: 0, color: 'var(--exim-gray-800)' }}>
                {isEditing ? 'Configure Connection Details' : 'Active SAP Configuration'}
              </Title>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {isEditing 
                  ? 'Update the SAP host information and authentication credentials below.' 
                  : 'Current authentication details for the SAP connection.'}
              </Text>
            </div>
            {configured != null && !isEditing && (
              <Tag color={configured ? 'green' : 'default'} style={{ margin: 0 }}>
                {configured ? 'Configured' : 'Not configured'}
              </Tag>
            )}
          </div>

          {!isEditing ? (
            <Row gutter={[24, 24]}>
              <Col xs={24} md={12} lg={8}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>SAP USER ID</Text>
                <Text strong>{userId || '-'}</Text>
              </Col>
              <Col xs={24} md={12} lg={8}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>PASSWORD</Text>
                <Text strong>{password ? '••••••••••••' : '-'}</Text>
              </Col>
              <Col xs={24} md={12} lg={8}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>SAP CONNECTION</Text>
                <Text strong>{sapConnection || '-'}</Text>
              </Col>
              <Col xs={24} md={12} lg={8}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>SALES TCODE</Text>
                <Tag>{reportTcode || '-'}</Tag>
              </Col>
              <Col xs={24} md={12} lg={8}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>JV UPLOAD TCODE</Text>
                <Tag>{uploadTcode || '-'}</Tag>
              </Col>
            </Row>
          ) : (
            <Row gutter={[24, 24]} style={{ maxWidth: 800 }}>
              <Col xs={24} md={12}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
                  SAP user ID
                </Text>
                <Input
                  value={draftUserId}
                  onChange={(e) => setDraftUserId(e.target.value)}
                  placeholder="SAP_USER_ID"
                  autoComplete="off"
                  disabled={saving}
                />
              </Col>
              <Col xs={24} md={12}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
                  Password
                </Text>
                <Input.Password
                  value={draftPassword}
                  onChange={(e) => setDraftPassword(e.target.value)}
                  placeholder="SAP password"
                  autoComplete="new-password"
                  disabled={saving}
                />
              </Col>
              <Col xs={24} md={24}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
                  SAP connection
                </Text>
                <Input
                  value={draftSapConnection}
                  onChange={(e) => setDraftSapConnection(e.target.value)}
                  placeholder="SAP_CONNECTION"
                  autoComplete="off"
                  disabled={saving}
                />
              </Col>
              <Col xs={24} md={12}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
                  SALES TCODE
                </Text>
                <Input
                  value={draftReportTcode}
                  onChange={(e) => setDraftReportTcode(e.target.value)}
                  placeholder="SAP report transaction code"
                  autoComplete="off"
                  disabled={saving}
                />
              </Col>
              <Col xs={24} md={12}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
                  JV UPLOAD TCODE
                </Text>
                <Input
                  value={draftUploadTcode}
                  onChange={(e) => setDraftUploadTcode(e.target.value)}
                  placeholder="SAP upload transaction code"
                  autoComplete="off"
                  disabled={saving}
                />
              </Col>
            </Row>
          )}
        </div>
      </div>
    </AppShell>
  )
}
