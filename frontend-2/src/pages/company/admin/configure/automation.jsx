import { Button, DatePicker, InputNumber, Layout, Space, Switch, Typography, message } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography

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

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                Automation
              </Title>
              <Text type="secondary">
                Enable or disable automated sales, PDF, and JV jobs for this company.
              </Text>
            </div>

            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                }}
              >
                <div>
                  <Text strong>Sales automation</Text>
                  <br />
                  <Text type="secondary">Automatically fetch sales data from SAP.</Text>
                </div>
                <Switch
                  checked={salesEnabled}
                  onChange={setSalesEnabled}
                  disabled={loading || saving}
                  checkedChildren="On"
                  unCheckedChildren="Off"
                />
              </div>

              {salesEnabled ? (
                <Space direction="vertical" size="middle" style={{ width: '100%', paddingLeft: 8 }}>
                  <div>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                      Data start from
                    </Text>
                    <DatePicker
                      value={dataStartFrom}
                      onChange={setDataStartFrom}
                      format="DD-MM-YYYY"
                      disabled={loading || saving}
                      style={{ width: '100%' }}
                      placeholder="Select earliest sales date"
                    />
                    <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                      Earliest billing date to include when fetching sales data from SAP.
                    </Text>
                  </div>
                  <Text type="secondary">
                    Cooling period: on a new month, also fetch the last N days of the previous month
                    and the first M days of the current month.
                  </Text>
                  <div>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                      Month end effective days
                    </Text>
                    <InputNumber
                      min={0}
                      max={31}
                      value={monthEndEffectiveDays}
                      onChange={(value) => setMonthEndEffectiveDays(value ?? 0)}
                      disabled={loading || saving}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                      Month start effective days
                    </Text>
                    <InputNumber
                      min={0}
                      max={31}
                      value={monthStartEffectiveDays}
                      onChange={(value) => setMonthStartEffectiveDays(value ?? 0)}
                      disabled={loading || saving}
                      style={{ width: '100%' }}
                    />
                  </div>
                </Space>
              ) : null}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  marginTop: 8,
                }}
              >
                <div>
                  <Text strong>PDF automation</Text>
                  <br />
                  <Text type="secondary">Automatically fetch PDF data from the configured mailbox.</Text>
                </div>
                <Switch
                  checked={pdfEnabled}
                  onChange={setPdfEnabled}
                  disabled={loading || saving}
                  checkedChildren="On"
                  unCheckedChildren="Off"
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  marginTop: 8,
                }}
              >
                <div>
                  <Text strong>JV automation</Text>
                  <br />
                  <Text type="secondary">
                    Run JV DBK and RODTP (automation step 9). When off, step 9 is skipped.
                  </Text>
                </div>
                <Switch
                  checked={jvEnabled}
                  onChange={setJvEnabled}
                  disabled={loading || saving}
                  checkedChildren="On"
                  unCheckedChildren="Off"
                />
              </div>

              <Space wrap>
                <Button type="primary" loading={saving} onClick={handleSave} disabled={!BACKEND_URL}>
                  Save settings
                </Button>
                <Button onClick={loadSettings} loading={loading} disabled={!BACKEND_URL}>
                  Reload
                </Button>
              </Space>
            </Space>
          </Space>
        </AppShell>
  )
}
