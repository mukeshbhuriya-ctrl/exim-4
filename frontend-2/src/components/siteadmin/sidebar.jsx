import { Layout, Menu } from 'antd'
import { BankOutlined, DashboardOutlined, WalletOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'

const { Sider } = Layout

const menuItems = [
  {
    key: '/siteadmin/dashboard',
    icon: <DashboardOutlined />,
    label: 'Dashboard',
  },
  {
    key: '/siteadmin/company',
    icon: <BankOutlined />,
    label: 'Companies',
  },
  {
    key: '/siteadmin/billing',
    icon: <WalletOutlined />,
    label: 'Billing',
  },
  {
    key: '/siteadmin/view-billes',
    icon: <WalletOutlined />,
    label: 'View Bills',
  },
]

export default function SiteAdminSidebar() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <Sider
      width={260}
      theme="dark"
      style={{
        background: 'var(--exim-sidebar-bg)',
        borderRight: 'none',
        position: 'sticky',
        top: 0,
        height: '100vh',
        overflow: 'auto',
      }}
    >
      {/* Brand */}
      <div
        style={{
          padding: '20px 20px 16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #1B4DFF 0%, #3B6FFF 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(27, 77, 255, 0.3)',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
              <path d="M8 10h10M8 16h14M8 22h10" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
              <path d="M22 8l4 4-4 4" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <div style={{
              fontSize: 16,
              fontWeight: 700,
              color: '#FFFFFF',
              lineHeight: 1.2,
              letterSpacing: '-0.3px',
            }}>
              EXIM
            </div>
            <div style={{
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--exim-sidebar-text)',
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
            }}>
              Site Admin
            </div>
          </div>
        </div>
      </div>

      <Menu
        mode="inline"
        theme="dark"
        selectedKeys={[location.pathname]}
        items={menuItems}
        onClick={({ key }) => navigate(key)}
        style={{
          background: 'transparent',
          border: 'none',
          padding: '8px 0',
        }}
      />

      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '12px 20px',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <div style={{
          fontSize: 11,
          color: 'rgba(148, 163, 184, 0.5)',
          textAlign: 'center',
        }}>
          EXIM Automation v1.0
        </div>
      </div>
    </Sider>
  )
}
