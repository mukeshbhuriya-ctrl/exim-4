import { Button, Input, Layout, Space, Tag, Typography, message } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography

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

  const handleSave = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    const id = userId.trim()
    const conn = sapConnection.trim()
    const tcode = reportTcode.trim()
    const upload = uploadTcode.trim()
    if (!id || !password || !conn || !tcode || !upload) {
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
          password,
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
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save SAP credentials')
    } finally {
      setSaving(false)
    }
  }, [BACKEND_URL, userId, password, sapConnection, reportTcode, uploadTcode])

  useEffect(() => {
    loadCredentials()
  }, [loadCredentials])

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                SAP credentials
              </Title>
              <Text type="secondary">
                Store SAP login used for automated sales data fetch from SAP.
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
                  SAP user ID
                </Text>
                <Input
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="SAP_USER_ID"
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
                  placeholder="SAP password"
                  autoComplete="new-password"
                  disabled={loading || saving}
                />
              </div>
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                  SAP connection
                </Text>
                <Input
                  value={sapConnection}
                  onChange={(e) => setSapConnection(e.target.value)}
                  placeholder="SAP_CONNECTION"
                  autoComplete="off"
                  disabled={loading || saving}
                />
              </div>
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                  SALES TCODE
                </Text>
                <Input
                  value={reportTcode}
                  onChange={(e) => setReportTcode(e.target.value)}
                  placeholder="SAP report transaction code"
                  autoComplete="off"
                  disabled={loading || saving}
                />
              </div>

              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                  JV UPLOAD TCODE
                </Text>
                <Input
                  value={uploadTcode}
                  onChange={(e) => setUploadTcode(e.target.value)}
                  placeholder="SAP upload transaction code"
                  autoComplete="off"
                  disabled={loading || saving}
                />
              </div>

              <Space wrap>
                <Button type="primary" loading={saving} onClick={handleSave} disabled={!BACKEND_URL}>
                  Save credentials
                </Button>
                <Button onClick={loadCredentials} loading={loading} disabled={!BACKEND_URL}>
                  Reload
                </Button>
              </Space>
            </Space>
          </Space>
        </AppShell>
  )
}
