import { useState } from 'react'
import { Alert, Button, Card, Form, Input, Typography, ConfigProvider } from 'antd'
import { LockOutlined, MailOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

const { Title, Text } = Typography

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL

export default function SiteAdminLoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const onFinish = async (values) => {
    setLoading(true)
    setError('')

    try {
      const response = await fetch(`${BACKEND_URL}/api/siteadmin/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(values),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data?.detail || data?.message || 'Login failed')
      }

      localStorage.setItem('siteadmin_authenticated', 'true')
      navigate('/siteadmin/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1B4DFF',
          borderRadius: 6,
          colorTextHeading: '#1e293b', // slate-800
          colorText: '#475569', // slate-600
        },
        components: {
          Button: {
            controlHeightLG: 44,
            fontWeight: 500,
          },
          Input: {
            controlHeightLG: 44,
          },
          Card: {
            paddingLG: 40,
          }
        },
      }}
    >
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)',
        }}
      >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 40,
          color: '#fff',
        }}
      >
        <div style={{ maxWidth: 480 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 32 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: 'linear-gradient(135deg, #1B4DFF 0%, #3B6FFF 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 14px rgba(27, 77, 255, 0.4)',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
                <path d="M8 10h10M8 16h14M8 22h10" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M22 8l4 4-4 4" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#FFFFFF', lineHeight: 1.1, letterSpacing: '-0.5px' }}>EXIM</div>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#94A3B8', letterSpacing: '1px', textTransform: 'uppercase' }}>Automation</div>
            </div>
          </div>
          <Title level={1} style={{ color: '#FFFFFF', marginBottom: 12, fontSize: 36, letterSpacing: '-0.5px' }}>
            Site Admin Panel
          </Title>
          <Text style={{ color: 'rgba(148, 163, 184, 0.9)', fontSize: 16, lineHeight: 1.6 }}>
            Secure access for administrators. Manage companies and monitor operations
            from a unified dashboard.
          </Text>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 40,
          background: '#FFFFFF',
        }}
      >
        <Card
          style={{
            width: '100%',
            maxWidth: 440,
            borderRadius: 16,
            background: '#FFFFFF',
            border: 'none',
            boxShadow: 'none',
          }}
          styles={{ body: { padding: '0 40px' } }}
        >
          <Title level={3} style={{ marginTop: 0, marginBottom: 4, color: 'var(--exim-text-primary)', fontSize: 24, fontWeight: 700 }}>
            Sign in
          </Title>
          <Text style={{ color: 'var(--exim-text-secondary)' }}>Enter credentials to continue</Text>

          <Form
            layout="vertical"
            onFinish={onFinish}
            style={{ marginTop: 20 }}
            autoComplete="off"
          >
            <Form.Item
              label="Email"
              name="email"
              rules={[
                { required: true, message: 'Please enter your email' },
                { type: 'email', message: 'Please enter a valid email' },
              ]}
            >
              <Input
                size="large"
                prefix={<MailOutlined />}
                placeholder="admin@example.com"
              />
            </Form.Item>

            <Form.Item
              label="Password"
              name="password"
              rules={[{ required: true, message: 'Please enter your password' }]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder="Enter password"
              />
            </Form.Item>

            {error ? (
              <Form.Item style={{ marginBottom: 12 }}>
                <Alert type="error" message={error} showIcon />
              </Form.Item>
            ) : null}

            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              Login
            </Button>
          </Form>
        </Card>
      </div>
    </div>
    </ConfigProvider>
  )
}
