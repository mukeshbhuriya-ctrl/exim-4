import { Button, DatePicker, InputNumber, Layout, Space, Switch, Typography, message, Skeleton, Row, Col, Divider, Badge } from 'antd'
import dayjs from 'dayjs'
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

const CONFIGURE_AUTOMATION_BASE = '/api/company/admin/configure/automation'

function extractAutomationFromResponse(data) {
  if (!data || typeof data !== 'object') return null
  const automation = data.automation
  return automation && typeof automation === 'object' ? automation : null
}

export default function CompanyAdminConfigureAutomationPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [salesEnabled, setSalesEnabled] = useState(false)
  const [pdfEnabled, setPdfEnabled] = useState(false)
  const [jvEnabled, setJvEnabled] = useState(false)
  const [dataStartFrom, setDataStartFrom] = useState(null)
  const [monthStartEffectiveDays, setMonthStartEffectiveDays] = useState(0)
  const [monthEndEffectiveDays, setMonthEndEffectiveDays] = useState(0)
  
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  const applyAutomationToState = useCallback((automation) => {
    const sales = automation?.sales && typeof automation.sales === 'object' ? automation.sales : {}
    const pdf = automation?.pdf && typeof automation.pdf === 'object' ? automation.pdf : {}
    const jv = automation?.jv && typeof automation.jv === 'object' ? automation.jv : {}
    setSalesEnabled(sales.enabled === true)
    setPdfEnabled(pdf.enabled === true)
    setJvEnabled(jv.enabled === true)
    const rawStart = String(sales.dataStartFrom || '').trim()
    setDataStartFrom(rawStart ? dayjs(rawStart, 'YYYY-MM-DD') : null)
    setMonthStartEffectiveDays(Number(sales.monthStartEffectiveDays ?? 0))
    setMonthEndEffectiveDays(Number(sales.monthEndEffectiveDays ?? 0))
  }, [])

  const loadSettings = useCallback(async () => {
    if (!BACKEND_URL) return
    setLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}${CONFIGURE_AUTOMATION_BASE}`, {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Failed to load automation settings (${res.status})`)
      }
      const automation = extractAutomationFromResponse(data)
      if (automation) {
        applyAutomationToState(automation)
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load automation settings')
    } finally {
      setLoading(false)
    }
  }, [BACKEND_URL, applyAutomationToState])

  const handleSave = useCallback(async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }

    if (salesEnabled) {
      if (!dataStartFrom || !dayjs.isDayjs(dataStartFrom) || !dataStartFrom.isValid()) {
        message.error('Data start from date is required when sales automation is enabled.')
        return
      }
      if (monthStartEffectiveDays == null || monthEndEffectiveDays == null) {
        message.error('Month start and month end effective days are required when sales automation is enabled.')
        return
      }
    }

    setSaving(true)
    try {
      const res = await fetch(`${BACKEND_URL}${CONFIGURE_AUTOMATION_BASE}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sales: {
            enabled: salesEnabled,
            dataStartFrom:
              dataStartFrom && dayjs.isDayjs(dataStartFrom) && dataStartFrom.isValid()
                ? dataStartFrom.format('YYYY-MM-DD')
                : '',
            monthStartEffectiveDays,
            monthEndEffectiveDays,
          },
          pdf: {
            enabled: pdfEnabled,
          },
          jv: {
            enabled: jvEnabled,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Save failed (${res.status})`)
      }
      if (data?.success === false) {
        message.warning(data?.message || 'Save reported failure')
      } else {
        message.success(data?.message || 'Automation settings saved.')
      }
      const automation = extractAutomationFromResponse(data)
      if (automation) {
        applyAutomationToState(automation)
      }
      setIsEditing(false)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save automation settings')
    } finally {
      setSaving(false)
    }
  }, [
    BACKEND_URL,
    salesEnabled,
    pdfEnabled,
    jvEnabled,
    dataStartFrom,
    monthStartEffectiveDays,
    monthEndEffectiveDays,
    applyAutomationToState,
  ])

  const handleCancel = () => {
    setIsEditing(false)
    loadSettings()
  }

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  return (
    <AppShell sidebar={<CompanySidebar />}>
      <PageHeader 
        title="Automation Settings" 
        description="Enable or disable automated sales, PDF, and JV background jobs for this company."
      />
      <div style={sectionCardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
            <div>
              <Title level={5} style={{ margin: 0, color: 'var(--exim-gray-800)' }}>
                {isEditing ? 'Configure Automation Rules' : 'Active Automation Rules'}
              </Title>
              <Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
                {isEditing 
                  ? 'Toggle and configure parameters for background jobs.' 
                  : 'Current running status and parameters of automated jobs.'}
              </Text>
            </div>
            <Space wrap>
              {!isEditing && (
                <Button onClick={loadSettings} loading={loading}>Reload</Button>
              )}
              {!isEditing && (
                <Button type="primary" onClick={() => setIsEditing(true)}>Modify Configuration</Button>
              )}
            </Space>
          </div>

          {loading && !isEditing ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : !isEditing ? (
            <Space direction="vertical" style={{ width: '100%' }} size="large">
              <Row gutter={[24, 24]}>
                <Col span={24}>
                  <div style={{ padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <Text strong style={{ display: 'block', fontSize: 14 }}>Sales Automation</Text>
                        <Text type="secondary" style={{ fontSize: 13 }}>Automatically fetch sales data from SAP.</Text>
                      </div>
                      <Switch 
                        checked={salesEnabled} 
                        disabled 
                        checkedChildren="On" 
                        unCheckedChildren="Off"
                        style={{ backgroundColor: salesEnabled ? '#52c41a' : undefined }}
                      />
                    </div>
                    {salesEnabled && (
                      <div style={{ marginTop: 16, padding: '16px', background: '#fafafa', borderRadius: 8, border: '1px solid #e8e8e8' }}>
                        <Row gutter={[16, 16]}>
                          <Col xs={24} md={8}>
                            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>DATA START FROM</Text>
                            <Text strong>{dataStartFrom ? dataStartFrom.format('DD MMM YYYY') : '—'}</Text>
                          </Col>
                          <Col xs={24} md={8}>
                            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>MONTH START EFFECTIVE</Text>
                            <Text strong>{monthStartEffectiveDays} days</Text>
                          </Col>
                          <Col xs={24} md={8}>
                            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>MONTH END EFFECTIVE</Text>
                            <Text strong>{monthEndEffectiveDays} days</Text>
                          </Col>
                        </Row>
                      </div>
                    )}
                  </div>
                </Col>

                <Col span={24}>
                  <div style={{ padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <Text strong style={{ display: 'block', fontSize: 14 }}>PDF Automation</Text>
                        <Text type="secondary" style={{ fontSize: 13 }}>Automatically fetch PDF data from the configured mailbox.</Text>
                      </div>
                      <Switch 
                        checked={pdfEnabled} 
                        disabled 
                        checkedChildren="On" 
                        unCheckedChildren="Off"
                        style={{ backgroundColor: pdfEnabled ? '#52c41a' : undefined }}
                      />
                    </div>
                  </div>
                </Col>

                <Col span={24}>
                  <div style={{ padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <Text strong style={{ display: 'block', fontSize: 14 }}>JV Automation</Text>
                        <Text type="secondary" style={{ fontSize: 13 }}>Run JV DBK and RODTP background jobs.</Text>
                      </div>
                      <Switch 
                        checked={jvEnabled} 
                        disabled 
                        checkedChildren="On" 
                        unCheckedChildren="Off"
                        style={{ backgroundColor: jvEnabled ? '#52c41a' : undefined }}
                      />
                    </div>
                  </div>
                </Col>
              </Row>
            </Space>
          ) : (
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div>
                  <Text strong style={{ fontSize: 14 }}>Sales Automation</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 13 }}>Automatically fetch sales data from SAP.</Text>
                </div>
                <Switch
                  checked={salesEnabled}
                  onChange={setSalesEnabled}
                  disabled={saving}
                  checkedChildren="On"
                  unCheckedChildren="Off"
                />
              </div>

              {salesEnabled && (
                <div style={{ padding: '16px', background: '#fafafa', borderRadius: 8, border: '1px solid #e8e8e8' }}>
                  <Row gutter={[24, 24]}>
                    <Col xs={24} md={8}>
                      <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Data start from</Text>
                      <DatePicker
                        value={dataStartFrom}
                        onChange={setDataStartFrom}
                        format="DD-MM-YYYY"
                        disabled={saving}
                        style={{ width: '100%' }}
                        placeholder="Earliest sales date"
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Month start effective days</Text>
                      <InputNumber
                        min={0}
                        max={31}
                        value={monthStartEffectiveDays}
                        onChange={(value) => setMonthStartEffectiveDays(value ?? 0)}
                        disabled={saving}
                        style={{ width: '100%' }}
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Month end effective days</Text>
                      <InputNumber
                        min={0}
                        max={31}
                        value={monthEndEffectiveDays}
                        onChange={(value) => setMonthEndEffectiveDays(value ?? 0)}
                        disabled={saving}
                        style={{ width: '100%' }}
                      />
                    </Col>
                    <Col span={24}>
                       <Text type="secondary" style={{ fontSize: 12 }}>
                         <Text strong type="secondary">Cooling period logic:</Text> On a new month, also fetch the last N days of the previous month and the first M days of the current month.
                       </Text>
                    </Col>
                  </Row>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div>
                  <Text strong style={{ fontSize: 14 }}>PDF Automation</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 13 }}>Automatically fetch PDF data from the configured mailbox.</Text>
                </div>
                <Switch
                  checked={pdfEnabled}
                  onChange={setPdfEnabled}
                  disabled={saving}
                  checkedChildren="On"
                  unCheckedChildren="Off"
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div>
                  <Text strong style={{ fontSize: 14 }}>JV Automation</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 13 }}>Run JV DBK and RODTP background jobs. When off, step 9 is skipped.</Text>
                </div>
                <Switch
                  checked={jvEnabled}
                  onChange={setJvEnabled}
                  disabled={saving}
                  checkedChildren="On"
                  unCheckedChildren="Off"
                />
              </div>

              <Space wrap style={{ marginTop: 16 }}>
                <Button onClick={handleCancel}>Cancel</Button>
                <Button type="primary" loading={saving} onClick={handleSave} disabled={!BACKEND_URL}>
                  Save Settings
                </Button>
                <Button onClick={loadSettings} loading={loading} disabled={saving || !BACKEND_URL}>
                  Reload
                </Button>
              </Space>
            </Space>
          )}
        </div>
    </AppShell>
  )
}
