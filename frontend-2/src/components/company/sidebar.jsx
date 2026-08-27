import { Layout, Menu } from 'antd'
import {
  DashboardOutlined,
  SettingOutlined,
  SyncOutlined,
  FileTextOutlined,
  AuditOutlined,
  BankOutlined,
  LinkOutlined,
  BarChartOutlined,
  CloudDownloadOutlined,
  AccountBookOutlined,
  LogoutOutlined,
} from '@ant-design/icons'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { clearCompanySession, getCompanySession } from '../../utils/companySession.js'

const { Sider } = Layout

const INIT_PATHS = [
  '/admin/header-mapping',
  '/admin/sales-data-clean',
  '/admin/combination',
  '/admin/connect-combination',
]
const PROCESS_PATHS = [
  '/admin/upload-pdf',
  '/admin/fetch-pdf-data',
  '/admin/upload-sales',
  '/admin/start-process',
  '/admin/manual-process-match',
  '/admin/inv',
  '/admin/fetch-from-sap-sales',
]
const SHIPPING_PATHS = ['/admin/sb-batch', '/admin/sb']
const DGFT_PATHS = [
  '/admin/dgft/manual',
  '/admin/dgft/excel',
  '/admin/dgft/excel-to-process',
  '/admin/ebrc-bulk-download',
  '/admin/store-bulk-download',
  '/admin/pdf/dgft',
  '/admin/dgft',
]
const JV_PATHS = ['/admin/jv-dbks-format', '/admin/jv-dbk', '/admin/jv-rodtp-format', '/admin/jv-rodtp']
const CHA_PATHS = ['/admin/cha/process']
const CONFIGURE_PATHS = [
  '/admin/configure/sales',
  '/admin/configure/pdf',
  '/admin/configure/cha',
  '/admin/configure/dgft',
  '/admin/configure/automation',
  '/admin/configure/automation-logs',
]

function openKeysForPathname(pathname) {
  if (INIT_PATHS.some((p) => pathname === p)) return ['initialization']
  if (CONFIGURE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return ['configure']
  if (PROCESS_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return ['process']
  if (SHIPPING_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return ['shipping-bills']
  if (DGFT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return ['dgft']
  if (JV_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return ['jv']
  if (CHA_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return ['cha']
  return []
}

const menuItems = [
  {
    key: '/admin/dashboard',
    icon: <DashboardOutlined />,
    label: 'Dashboard',
  },
  {
    key: 'initialization',
    icon: <FileTextOutlined />,
    label: 'Initialization',
    children: [
      { key: '/admin/header-mapping', label: 'Header Mapping' },
      { key: '/admin/sales-data-clean', label: 'Sales Data Clean' },
      { key: '/admin/combination', label: 'Combination' },
      { key: '/admin/connect-combination', label: 'Connection' },
    ],
  },
  {
    key: 'configure',
    icon: <SettingOutlined />,
    label: 'Configure',
    children: [
      { key: '/admin/configure/sales', label: 'SAP Setup' },
      { key: '/admin/configure/pdf', label: 'LEO Copy Mail Setup' },
      { key: '/admin/configure/cha', label: 'ICEGATE CHA Setup' },
      { key: '/admin/configure/dgft', label: 'DGFT Setup' },
      { key: '/admin/configure/automation', label: 'Automation' },
      { key: '/admin/configure/automation-logs', label: 'Automation Logs' },
    ],
  },
  {
    key: 'process',
    icon: <SyncOutlined />,
    label: 'Process',
    children: [
      { key: '/admin/upload-pdf', label: 'LEO Copy' },
      // { key: '/admin/fetch-pdf-data', label: 'Fetch PDF Data' },
      { key: '/admin/upload-sales', label: 'Sales' },
      // { key: '/admin/fetch-from-sap-sales', label: 'Fetch from SAP' },
      { key: '/admin/start-process', label: 'Start Process' },
      { key: '/admin/manual-process-match', label: 'Manual Match' },
      { key: '/admin/inv', label: 'Matched Invoices' },
    ],
  },
  {
    key: 'cha',
    icon: <LinkOutlined />,
    label: 'CHA',
    children: [{ key: '/admin/cha/process', label: 'Monthly Process' }],
  },
  {
    key: 'shipping-bills',
    icon: <AuditOutlined />,
    label: 'Shipping Bills',
    children: [
      { key: '/admin/sb', label: 'SB Records' },
      { key: '/admin/sb-batch', label: 'SB Batch' },
    ],
  },
  {
    key: 'dgft',
    icon: <BankOutlined />,
    label: 'DGFT',
    children: [
      { key: '/admin/dgft', label: 'DGFT Records' },
      // { key: '/admin/dgft/manual', label: 'DGFT Manual' },
      { key: '/admin/dgft/excel', label: 'DGFT Batch Upload' },
      // { key: '/admin/dgft/excel-to-process', label: 'Excel → Process' },
      { key: '/admin/ebrc-bulk-download', label: 'eBRC Bulk Request' },
      { key: '/admin/store-bulk-download', label: 'Store Bulk Download' },
      { key: '/admin/pdf/dgft', label: 'eBRC PDFs' },
    ],
  },
  {
    key: 'jv',
    icon: <AccountBookOutlined />,
    label: 'Journal Voucher',
    children: [
      { key: '/admin/jv-dbks-format', label: 'DBK Format' },
      { key: '/admin/jv-dbk', label: 'JV DBK' },
      { key: '/admin/jv-rodtp-format', label: 'RoDTEP Format' },
      { key: '/admin/jv-rodtp', label: 'JV RoDTEP' },
    ],
  },
  {
    key: '/admin/reports',
    icon: <BarChartOutlined />,
    label: 'Reports',
  },
  {
    key: '/admin/reports/templates',
    icon: <CloudDownloadOutlined />,
    label: 'Report Templates',
  },
]

export default function CompanySidebar() {
  const navigate = useNavigate()
  const location = useLocation()

  const [openKeys, setOpenKeys] = useState([])
  const [session, setSession] = useState(() => getCompanySession())
  const lastRouteOpenKeysRef = useRef(null)

  useEffect(() => {
    setSession(getCompanySession())
  }, [location.pathname])

  useEffect(() => {
    const next = openKeysForPathname(location.pathname)
    const prevSig =
      lastRouteOpenKeysRef.current == null ? null : lastRouteOpenKeysRef.current.join('\0')
    const nextSig = next.join('\0')
    if (prevSig === nextSig) {
      return
    }
    lastRouteOpenKeysRef.current = next
    setOpenKeys(next)
  }, [location.pathname])

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
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Brand */}
        <div
          style={{
            padding: '20px 20px 16px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            flexShrink: 0,
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
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                title={session.companyName || 'EXIM'}
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#FFFFFF',
                  lineHeight: 1.2,
                  letterSpacing: '-0.3px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {session.companyName || 'EXIM'}
              </div>
              {session.email ? (
                <div
                  title={session.email}
                  style={{
                    marginTop: 6,
                    fontSize: 11,
                    fontWeight: 400,
                    color: 'rgba(148, 163, 184, 0.85)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {session.email}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <Menu
            mode="inline"
            theme="dark"
            selectedKeys={[location.pathname]}
            openKeys={openKeys}
            onOpenChange={setOpenKeys}
            items={menuItems}
            onClick={({ key }) => {
              if (key.startsWith('/admin')) navigate(key)
            }}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '8px 0',
            }}
          />
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            background: 'var(--exim-sidebar-bg)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{
            fontSize: 11,
            color: 'rgba(148, 163, 184, 0.5)',
          }}>
            EXIM Automation v1.0
          </div>
          
          <div
            onClick={() => {
              clearCompanySession()
              navigate('/login')
            }}
            title="Log out"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 'var(--radius-md)',
              color: 'var(--exim-sidebar-text)',
              cursor: 'pointer',
              transition: 'all 0.2s',
              marginRight: -4,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#FFFFFF'
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--exim-sidebar-text)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <LogoutOutlined style={{ fontSize: 15 }} />
          </div>
        </div>
      </div>
    </Sider>
  )
}
