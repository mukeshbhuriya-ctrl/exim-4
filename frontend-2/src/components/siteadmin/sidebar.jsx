import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Building2, CreditCard, Receipt, LogOut } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

const NAV = [
  { t: 'label', label: 'Administration' },
  { t: 'item', key: '/siteadmin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { t: 'item', key: '/siteadmin/company', label: 'Companies', icon: Building2 },
  { t: 'label', label: 'Finance' },
  { t: 'item', key: '/siteadmin/billing', label: 'Billing', icon: CreditCard },
  { t: 'item', key: '/siteadmin/view-billes', label: 'View Bills', icon: Receipt },
]

export default function SiteAdminSidebar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('exim-sa-sc') === '1')

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
    brandGradient: 'linear-gradient(135deg, #1B4DFF, #3B6FFF)'
  }

  const col = () => { setCollapsed(p => { const n = !p; localStorage.setItem('exim-sa-sc', n ? '1' : '0'); return n }); }

  useEffect(() => {
    const handleToggle = () => col()
    window.addEventListener('toggle-siteadmin-sidebar', handleToggle)
    return () => window.removeEventListener('toggle-siteadmin-sidebar', handleToggle)
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
            }} title="EXIM Automation">
              EXIM Automation
            </div>
            <div style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontSize: '12px',
              color: COLORS.textMuted,
              marginTop: '2px'
            }}>
              Site Admin
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
                marginTop: i === 0 ? '4px' : '20px',
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
            const active = pathname.startsWith(n.key)
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
                onClick={() => { localStorage.removeItem('siteadmin_authenticated'); navigate('/siteadmin/login') }}
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
            onClick={() => { localStorage.removeItem('siteadmin_authenticated'); navigate('/siteadmin/login') }}
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
