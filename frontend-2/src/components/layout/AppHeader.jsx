import { Avatar, Dropdown, Space, Typography } from 'antd'
import {
  LogoutOutlined,
  UserOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import { eraseCookies } from '../../utils/cookies.js'
import { clearCompanySession } from '../../utils/companySession.js'

const { Text } = Typography

const BREADCRUMB_MAP = {
  '/admin/dashboard': ['Dashboard'],
  '/admin/header-mapping': ['Initialization', 'Header Mapping'],
  '/admin/combination': ['Initialization', 'Combination'],
  '/admin/connect-combination': ['Initialization', 'Connection'],
  '/admin/upload-pdf': ['Process', 'Upload PDF'],
  '/admin/fetch-pdf-data': ['Process', 'Fetch PDF Data'],
  '/admin/upload-sales': ['Process', 'Upload Sales'],
  '/admin/fetch-from-sap-sales': ['Process', 'Fetch from SAP'],
  '/admin/start-process': ['Process', 'Start Process'],
  '/admin/manual-process-match': ['Process', 'Manual Match'],
  '/admin/sb': ['Shipping Bills', 'SB'],
  '/admin/sb-batch': ['Shipping Bills', 'SB Batch'],
  '/admin/dgft': ['DGFT', 'Records'],
  '/admin/dgft/manual': ['DGFT', 'Manual'],
  '/admin/dgft/excel': ['DGFT', 'Excel Upload'],
  '/admin/dgft/excel-to-process': ['DGFT', 'Excel → Process'],
  '/admin/ebrc-bulk-download': ['DGFT', 'eBRC Bulk Download'],
  '/admin/store-bulk-download': ['DGFT', 'Store Bulk Download'],
  '/admin/pdf/dgft': ['DGFT', 'eBRC PDFs'],
  '/admin/jv-dbks-format': ['JV', 'DBK Format'],
  '/admin/jv-dbk': ['JV', 'DBK'],
  '/admin/jv-rodtp-format': ['JV', 'RoDTEP Format'],
  '/admin/jv-rodtp': ['JV', 'RoDTEP'],
  '/admin/cha/process': ['CHA', 'Current Month'],
  '/admin/reports': ['Reports'],
  '/admin/reports/templates': ['Reports', 'Templates'],
  '/admin/configure/sales': ['Configure', 'SAP Credentials'],
  '/admin/configure/pdf': ['Configure', 'PDF Setup'],
  '/admin/configure/cha': ['Configure', 'CHA Setup'],
  '/admin/configure/dgft': ['Configure', 'DGFT Credentials'],
  '/admin/configure/automation': ['Configure', 'Automation'],
  '/admin/configure/automation-logs': ['Configure', 'Automation Logs'],
}

export default function AppHeader({ portalType = 'company' }) {
  const navigate = useNavigate()
  const location = useLocation()

  const breadcrumbs = BREADCRUMB_MAP[location.pathname] || []

  const handleLogout = async () => {
    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL
    try {
      await fetch(`${BACKEND_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // ignore
    }
    eraseCookies(['company_session', 'siteadmin_session', 'user_session'])
    if (portalType === 'siteadmin') {
      localStorage.removeItem('siteadmin_authenticated')
      navigate('/siteadmin/login', { replace: true })
    } else {
      clearCompanySession()
      navigate('/login', { replace: true })
    }
  }

  const userMenuItems = [
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Settings',
      onClick: () => navigate(portalType === 'siteadmin' ? '/siteadmin/dashboard' : '/admin/configure/automation'),
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Sign out',
      danger: true,
      onClick: handleLogout,
    },
  ]

  return (
    <header
      style={{
        height: 56,
        background: 'var(--exim-surface)',
        borderBottom: '1px solid var(--exim-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backdropFilter: 'blur(12px)',
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
      }}
    >
      {/* Left — breadcrumbs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <Text style={{ color: 'var(--exim-text-muted)', fontSize: 13 }}>
          {portalType === 'siteadmin' ? 'Site Admin' : 'EXIM'}
        </Text>
        {breadcrumbs.map((crumb, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--exim-gray-300)', fontSize: 12 }}>/</span>
            <Text
              style={{
                fontSize: 13,
                color: i === breadcrumbs.length - 1 ? 'var(--exim-text-primary)' : 'var(--exim-text-muted)',
                fontWeight: i === breadcrumbs.length - 1 ? 600 : 400,
              }}
            >
              {crumb}
            </Text>
          </span>
        ))}
      </div>

      {/* Right — user menu */}
      <Dropdown menu={{ items: userMenuItems }} trigger={['click']} placement="bottomRight">
        <Space
          style={{
            cursor: 'pointer',
            padding: '4px 12px',
            borderRadius: 'var(--radius-md)',
            transition: 'background var(--transition-fast)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--exim-gray-50)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <Avatar
            size={32}
            icon={<UserOutlined />}
            style={{
              background: 'var(--exim-primary-light)',
              color: 'var(--exim-primary)',
            }}
          />
        </Space>
      </Dropdown>
    </header>
  )
}
