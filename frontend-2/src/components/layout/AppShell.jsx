import { Layout } from 'antd'
import AppHeader from './AppHeader.jsx'

const { Content } = Layout

/**
 * AppShell — wraps every authenticated page with sidebar + header + content area.
 *
 * Usage:
 *   <AppShell sidebar={<CompanySidebar />}>
 *     <PageHeader title="..." />
 *     {children}
 *   </AppShell>
 */
export default function AppShell({ children, sidebar, portalType = 'company' }) {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      {sidebar}
      <Layout style={{ minWidth: 0, background: 'var(--exim-bg)' }}>
        <AppHeader portalType={portalType} />
        <Content
          style={{
            padding: 24,
            minWidth: 0,
            maxWidth: '100%',
            boxSizing: 'border-box',
            overflowX: 'hidden',
          }}
        >
          <div className="exim-fade-in">
            {children}
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}
