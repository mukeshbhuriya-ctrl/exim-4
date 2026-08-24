import { Space, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import SiteAdminSidebar from '../../components/siteadmin/sidebar.jsx'
import AppShell from '../../components/layout/AppShell.jsx'
import PageHeader from '../../components/common/PageHeader.jsx'
import StatCard from '../../components/common/StatCard.jsx'
import {
  BankOutlined,
  DashboardOutlined,
  WalletOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons'

const { Text } = Typography

export default function SiteAdminDashboardPage() {
  const navigate = useNavigate()

  return (
    <AppShell sidebar={<SiteAdminSidebar />} portalType="siteadmin">
      <PageHeader
        title="Site Admin Dashboard"
        description="Manage companies, billing, and system operations"
      />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatCard
          title="System"
          value="Online"
          subtitle="All services running"
          icon={<DashboardOutlined />}
          color="var(--exim-success)"
        />
      </div>

      {/* Quick Actions */}
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--exim-text-primary)', marginBottom: 16 }}>
        Quick Actions
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 16,
      }}>
        {[
          { key: 'companies', icon: <BankOutlined style={{ fontSize: 22, color: 'var(--exim-primary)' }} />, title: 'Companies', description: 'Create and manage company accounts', path: '/siteadmin/company', color: 'var(--exim-primary-50)' },
          { key: 'billing', icon: <WalletOutlined style={{ fontSize: 22, color: '#059669' }} />, title: 'Billing', description: 'Manage billing and invoices', path: '/siteadmin/billing', color: 'var(--exim-success-light)' },
        ].map((action) => (
          <div
            key={action.key}
            onClick={() => navigate(action.path)}
            style={{
              background: 'var(--exim-surface)',
              border: '1px solid var(--exim-border-light)',
              borderRadius: 'var(--radius-lg)',
              padding: 20,
              cursor: 'pointer',
              transition: 'all var(--transition-base)',
              boxShadow: 'var(--shadow-xs)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 16,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = 'var(--shadow-md)'
              e.currentTarget.style.transform = 'translateY(-2px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'var(--shadow-xs)'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 'var(--radius-md)',
              background: action.color, display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexShrink: 0,
            }}>
              {action.icon}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{
                fontSize: 14, fontWeight: 600, color: 'var(--exim-text-primary)', marginBottom: 4,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                {action.title}
                <ArrowRightOutlined style={{ fontSize: 12, color: 'var(--exim-gray-400)' }} />
              </div>
              <div style={{ fontSize: 13, color: 'var(--exim-text-secondary)' }}>{action.description}</div>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  )
}
