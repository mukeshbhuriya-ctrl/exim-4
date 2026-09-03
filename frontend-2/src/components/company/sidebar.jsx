import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { clearCompanySession, getCompanySession } from '../../utils/companySession.js'
import {
  LayoutDashboard, Layers, Settings, Zap, Link2, Ship, Landmark,
  BookOpen, BarChart3, FileCode2, ChevronDown, PanelLeftClose,
  PanelLeft, LogOut, Circle, RefreshCcw
} from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

/* ═══════════════════════════════════════════════════════════
   Navigation Configuration
   ═══════════════════════════════════════════════════════════ */
const NAV = [
  { t: 'item', key: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { t: 'label', label: 'Setup' },
  {
    t: 'group', key: 'initialization', label: 'Initialization', icon: Layers, children: [
      { key: '/admin/header-mapping', label: 'Header Mapping' },
      { key: '/admin/sales-data-clean', label: 'Sales Data Clean' },
      { key: '/admin/combination', label: 'Combination' },
      { key: '/admin/connect-combination', label: 'Connection' },
    ]
  },
  { t: 'label', label: 'Settings' },
  {
    t: 'group', key: 'configure', label: 'Configure', icon: Settings, children: [
      { key: '/admin/configure/sales', label: 'SAP Setup' },
      { key: '/admin/configure/pdf', label: 'LEO Copy Mail Setup' },
      { key: '/admin/configure/cha', label: 'ICEGATE CHA Setup' },
      { key: '/admin/configure/dgft', label: 'DGFT Setup' },
      { key: '/admin/configure/automation', label: 'Automation' },
      { key: '/admin/configure/automation-logs', label: 'Automation Logs' },
    ]
  },
  { t: 'label', label: 'Operations' },
  {
    t: 'group', key: 'process', label: 'Process', icon: Zap, children: [
      { key: '/admin/upload-pdf', label: 'LEO Copy' },
      { key: '/admin/upload-sales', label: 'Sales' },
      { key: '/admin/start-process', label: 'Start Process' },
      { key: '/admin/manual-process-match', label: 'Manual Match' },
      { key: '/admin/inv', label: 'Matched Invoices' },
    ]
  },
  {
    t: 'group', key: 'cha', label: 'CHA', icon: Link2, children: [
      { key: '/admin/cha/process', label: 'Monthly Process' },
    ]
  },
  { t: 'label', label: 'Compliance' },
  {
    t: 'group', key: 'shipping-bills', label: 'Shipping Bills', icon: Ship, children: [
      { key: '/admin/sb', label: 'SB Records' },
    ]
  },
  {
    t: 'group', key: 'dgft', label: 'DGFT', icon: Landmark, children: [
      { key: '/admin/dgft', label: 'DGFT Records' },
      { key: '/admin/ebrc-bulk-download', label: 'eBRC Bulk Request' },
      { key: '/admin/store-bulk-download', label: 'Store Bulk Download' },
      { key: '/admin/pdf/dgft', label: 'eBRC PDFs' },
    ]
  },
  {
    t: 'group', key: 'jv', label: 'Journal Voucher', icon: BookOpen, children: [
      { key: '/admin/jv-dbk', label: 'DBK' },
      { key: '/admin/jv-rodtp', label: 'RoDTEP' },
    ]
  },
  { t: 'label', label: 'Analytics' },
  { t: 'item', key: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { t: 'item', key: '/admin/reports/templates', label: 'Report Templates', icon: FileCode2 },
  { t: 'label', label: 'Manual Fetch' },
  {
    t: 'group', key: 'manual-fetch', label: 'Manual Fetch', icon: RefreshCcw, children: [
      { key: '/admin/sb-batch', label: 'SB Batch' },
      { key: '/admin/dgft/excel', label: 'DGFT Batch Upload' },
    ]
  },
]

function findGroup(p) {
  for (const n of NAV)
    if (n.t === 'group' && n.children?.some(c => p === c.key))
      return n.key
  return null
}

/* ═══════════════════════════════════════════════════════════
   Main Sidebar Component - using guaranteed inline styles for colors
   ═══════════════════════════════════════════════════════════ */
export default function CompanySidebar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('exim-sc') === '1')
  const [openKeys, setOpenKeys] = useState(() => {
    const g = findGroup(pathname)
    return g ? [g] : []
  })
  const [session, setSession] = useState(() => getCompanySession())
  const prevGroup = useRef(findGroup(pathname))

  // Theme constants
  const COLORS = {
    bg: '#111827', // Gray 900
    border: '#374151', // Gray 700
    textMuted: '#9CA3AF', // Gray 400
    textNormal: '#D1D5DB', // Gray 300
    textBright: '#F9FAFB', // Gray 50
    hoverBg: '#1F2937', // Gray 800
    activeBg: 'rgba(59, 130, 246, 0.12)', // Subtle blue background
    activeText: '#60A5FA', // Bright blue text
    activeChildBg: 'transparent',
    activeChildText: '#60A5FA', // Bright blue text
    brandGradient: 'linear-gradient(135deg, #3B82F6, #1D4ED8)'
  }

  useEffect(() => {
    setSession(getCompanySession())
    const g = findGroup(pathname)
    if (g && g !== prevGroup.current) { prevGroup.current = g; setOpenKeys(p => p.includes(g) ? p : [...p, g]) }
  }, [pathname])

  const toggle = (k) => setOpenKeys(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k])
  const col = () => { setCollapsed(p => { const n = !p; localStorage.setItem('exim-sc', n ? '1' : '0'); return n }); }

  useEffect(() => {
    const handleToggle = () => col()
    window.addEventListener('toggle-sidebar', handleToggle)
    return () => window.removeEventListener('toggle-sidebar', handleToggle)
  }, [])

  return (
    <aside
      style={{
        position: 'sticky',
        top: 0,
        backgroundColor: COLORS.bg,
        borderRight: `1px solid ${COLORS.border}`,
        width: collapsed ? '68px' : '260px',
        transition: 'width 300ms ease',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        zIndex: 40
      }}
    >
      {/* ── Brand ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: `1px solid ${COLORS.border}`,
        padding: collapsed ? '16px' : '16px 20px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: '12px',
        flexShrink: 0
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '36px',
          height: '36px',
          borderRadius: '8px',
          background: COLORS.brandGradient,
          flexShrink: 0
        }}>
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
            <path d="M8 10h10M8 16h14M8 22h10" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M22 8l4 4-4 4" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        {!collapsed && (
          <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
            <div style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontSize: '15px',
              fontWeight: 600,
              color: COLORS.textBright
            }} title={session.companyName || 'Exim Automation'}>
              {session.companyName || 'Exim Automation'}
            </div>
            <div style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontSize: '12px',
              color: COLORS.textMuted,
              marginTop: '2px'
            }} title={session.email || ''}>
              {session.email || 'Enterprise Suite'}
            </div>
          </div>
        )}
      </div>

      {/* ── Nav ── */}
      <nav style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '12px 8px',
        scrollbarWidth: 'thin',
        scrollbarColor: `${COLORS.border} transparent`
      }}>
        {NAV.map((n, i) => {
          // Section label
          if (n.t === 'label') {
            if (collapsed) return <div key={i} style={{ margin: '16px auto', height: '1px', width: '24px', backgroundColor: COLORS.border }} />
            return (
              <div key={i} style={{
                marginTop: i === 1 ? '4px' : '20px',
                marginBottom: '8px',
                paddingLeft: '12px',
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: COLORS.textMuted
              }}>
                {n.label}
              </div>
            )
          }

          // Top-level item
          if (n.t === 'item') {
            const active = pathname === n.key
            const Icon = n.icon
            const button = (
              <button
                key={n.key}
                onClick={() => navigate(n.key)}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = COLORS.hoverBg; e.currentTarget.style.color = COLORS.textBright; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = COLORS.textNormal; }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  border: active ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid transparent',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  marginBottom: '4px',
                  backgroundColor: active ? COLORS.activeBg : 'transparent',
                  color: active ? COLORS.activeText : COLORS.textNormal,
                  padding: collapsed ? '10px' : '10px 12px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  gap: '12px',
                  transition: 'background-color 0.2s, color 0.2s',
                  fontSize: '14px',
                  fontWeight: active ? 500 : 400
                }}
              >
                <Icon size={collapsed ? 20 : 18} strokeWidth={active ? 2 : 1.75} style={{ flexShrink: 0, color: active ? COLORS.activeText : COLORS.textMuted }} />
                {!collapsed && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.label}</span>}
              </button>
            )

            if (collapsed) {
              return (
                <Tooltip key={n.key} delayDuration={0}>
                  <TooltipTrigger asChild>
                    {button}
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={14} className="bg-slate-900 text-white font-medium border-slate-800">
                    {n.label}
                  </TooltipContent>
                </Tooltip>
              )
            }
            return button
          }

          // Collapsible group
          if (n.t === 'group') {
            const Icon = n.icon
            const open = openKeys.includes(n.key)
            const activeChild = n.children?.some(c => pathname === c.key)

            if (collapsed) {
              return (
                <Tooltip key={n.key} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => n.children?.[0] && navigate(n.children[0].key)}
                      onMouseEnter={(e) => { if (!activeChild) e.currentTarget.style.backgroundColor = COLORS.hoverBg; }}
                      onMouseLeave={(e) => { if (!activeChild) e.currentTarget.style.backgroundColor = 'transparent'; }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '100%',
                        border: activeChild ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid transparent',
                        cursor: 'pointer',
                        borderRadius: '6px',
                        marginBottom: '4px',
                        backgroundColor: activeChild ? COLORS.activeBg : 'transparent',
                        color: activeChild ? COLORS.activeText : COLORS.textNormal,
                        padding: '10px',
                        transition: 'background-color 0.2s'
                      }}
                    >
                      <Icon size={20} strokeWidth={activeChild ? 2 : 1.75} style={{ color: activeChild ? COLORS.activeText : COLORS.textMuted }} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={14} className="bg-slate-900 text-white font-medium border-slate-800">
                    {n.label}
                  </TooltipContent>
                </Tooltip>
              )
            }

            return (
              <div key={n.key} style={{ marginBottom: '4px' }}>
                <button
                  onClick={() => toggle(n.key)}
                  onMouseEnter={(e) => { if (!activeChild) e.currentTarget.style.backgroundColor = COLORS.hoverBg; e.currentTarget.style.color = COLORS.textBright; }}
                  onMouseLeave={(e) => { if (!activeChild) e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = COLORS.textNormal; }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    width: '100%',
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: '6px',
                    backgroundColor: 'transparent',
                    color: activeChild ? COLORS.textBright : COLORS.textNormal,
                    padding: '10px 12px',
                    gap: '12px',
                    transition: 'background-color 0.2s, color 0.2s',
                    fontSize: '14px',
                    fontWeight: activeChild ? 500 : 400
                  }}
                >
                  <Icon size={18} strokeWidth={activeChild ? 2 : 1.75} style={{ flexShrink: 0, color: activeChild ? COLORS.activeChildText : COLORS.textMuted }} />
                  <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.label}</span>
                  <ChevronDown size={16} strokeWidth={2} style={{ flexShrink: 0, color: COLORS.textMuted, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>
                <div style={{
                  display: 'grid',
                  gridTemplateRows: open ? '1fr' : '0fr',
                  transition: 'grid-template-rows 0.2s ease-in-out'
                }}>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{
                      marginLeft: '21px',
                      borderLeft: `1px solid ${COLORS.border}`,
                      paddingLeft: '12px',
                      paddingTop: '4px',
                      paddingBottom: '4px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px'
                    }}>
                      {n.children?.map(child => {
                        const active = pathname === child.key
                        return (
                          <button
                            key={child.key}
                            onClick={() => navigate(child.key)}
                            onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = COLORS.hoverBg; e.currentTarget.style.color = COLORS.textBright; }}
                            onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = COLORS.textNormal; }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              width: '100%',
                              border: active ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid transparent',
                              cursor: 'pointer',
                              borderRadius: '6px',
                              backgroundColor: active ? COLORS.activeChildBg : 'transparent',
                              color: active ? COLORS.activeChildText : COLORS.textNormal,
                              padding: '8px 10px',
                              gap: '10px',
                              transition: 'background-color 0.2s, color 0.2s',
                              fontSize: '13px',
                              fontWeight: active ? 500 : 400
                            }}
                          >
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{child.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )
          }

          return null
        })}
      </nav>

      {/* ── Footer ── */}
      <div style={{
        flexShrink: 0,
        borderTop: `1px solid ${COLORS.border}`,
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        alignItems: collapsed ? 'center' : 'stretch'
      }}>
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={() => { clearCompanySession(); navigate('/login') }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'; e.currentTarget.style.color = '#F87171'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = COLORS.textNormal; }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  border: 'none',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  backgroundColor: 'transparent',
                  color: COLORS.textNormal,
                  padding: '10px',
                  gap: '12px',
                  transition: 'background-color 0.2s, color 0.2s',
                  fontSize: '13px'
                }}
              >
                <LogOut size={18} strokeWidth={1.75} style={{ flexShrink: 0, color: 'inherit' }} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={14} className="bg-slate-900 text-white font-medium border-slate-800">
              Sign out
            </TooltipContent>
          </Tooltip>
        ) : (
          <button
            onClick={() => { clearCompanySession(); navigate('/login') }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'; e.currentTarget.style.color = '#F87171'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = COLORS.textNormal; }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              width: '100%',
              border: 'none',
              cursor: 'pointer',
              borderRadius: '6px',
              backgroundColor: 'transparent',
              color: COLORS.textNormal,
              padding: '10px 12px',
              gap: '12px',
              transition: 'background-color 0.2s, color 0.2s',
              fontSize: '13px'
            }}
          >
            <LogOut size={18} strokeWidth={1.75} style={{ flexShrink: 0, color: 'inherit' }} />
            <span style={{ flex: 1, textAlign: 'left' }}>Sign out</span>
          </button>
        )}
      </div>
    </aside>
  )
}
