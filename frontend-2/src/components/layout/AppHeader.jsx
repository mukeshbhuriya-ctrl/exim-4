import { useNavigate, useLocation } from 'react-router-dom'
import { eraseCookies } from '../../utils/cookies.js'
import { clearCompanySession } from '../../utils/companySession.js'
import { cn } from '@/lib/utils'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Settings, LogOut, User, ChevronRight, PanelLeft } from 'lucide-react'

const BREADCRUMB_MAP = {
  '/admin/dashboard': ['Dashboard'],
  '/admin/header-mapping': ['Initialization', 'Header Mapping'],
  '/admin/sales-data-clean': ['Initialization', 'Sales Data Clean'],
  '/admin/combination': ['Initialization', 'Combination'],
  '/admin/connect-combination': ['Initialization', 'Connection'],
  '/admin/upload-pdf': ['Process', 'LEO Copy'],
  '/admin/fetch-pdf-data': ['Process', 'Fetch PDF Data'],
  '/admin/upload-sales': ['Process', 'Sales'],
  '/admin/fetch-from-sap-sales': ['Process', 'Fetch from SAP'],
  '/admin/start-process': ['Process', 'Start Process'],
  '/admin/manual-process-match': ['Process', 'Manual Match'],
  '/admin/inv': ['Process', 'Matched Invoices'],
  '/admin/sb': ['Shipping Bills', 'SB Records'],
  '/admin/sb-batch': ['Shipping Bills', 'SB Batch'],
  '/admin/dgft': ['DGFT', 'Records'],
  '/admin/dgft/manual': ['DGFT', 'Manual'],
  '/admin/dgft/excel': ['DGFT', 'Batch Upload'],
  '/admin/dgft/excel-to-process': ['DGFT', 'Excel → Process'],
  '/admin/ebrc-bulk-download': ['DGFT', 'eBRC Bulk Download'],
  '/admin/store-bulk-download': ['DGFT', 'Store Bulk Download'],
  '/admin/pdf/dgft': ['DGFT', 'eBRC PDFs'],
  '/admin/jv-dbks-format': ['Journal Voucher', 'DBK Format'],
  '/admin/jv-dbk': ['Journal Voucher', 'DBK'],
  '/admin/jv-rodtp-format': ['Journal Voucher', 'RoDTEP Format'],
  '/admin/jv-rodtp': ['Journal Voucher', 'RoDTEP'],
  '/admin/cha/process': ['CHA', 'Monthly Process'],
  '/admin/reports': ['Reports'],
  '/admin/reports/templates': ['Reports', 'Templates'],
  '/admin/configure/sales': ['Settings', 'SAP Setup'],
  '/admin/configure/pdf': ['Settings', 'LEO Copy Mail'],
  '/admin/configure/cha': ['Settings', 'ICEGATE CHA'],
  '/admin/configure/dgft': ['Settings', 'DGFT Setup'],
  '/admin/configure/automation': ['Settings', 'Automation'],
  '/admin/configure/automation-logs': ['Settings', 'Automation Logs'],
}

export default function AppHeader({ portalType = 'company' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const breadcrumbs = BREADCRUMB_MAP[location.pathname] || []

  const handleLogout = async () => {
    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL
    try {
      await fetch(`${BACKEND_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch { /* ignore */ }
    eraseCookies(['company_session', 'siteadmin_session', 'user_session'])
    if (portalType === 'siteadmin') {
      localStorage.removeItem('siteadmin_authenticated')
      navigate('/siteadmin/login', { replace: true })
    } else {
      clearCompanySession()
      navigate('/login', { replace: true })
    }
  }

  return (
    <header className="sticky top-0 z-50 flex h-[52px] shrink-0 items-center justify-between border-b border-slate-200/60 bg-white/70 px-5 backdrop-blur-2xl backdrop-saturate-150">
      {/* Breadcrumbs & Toggle */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={() => window.dispatchEvent(new Event('toggle-sidebar'))}
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950"
          title="Toggle Sidebar"
        >
          <PanelLeft className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </button>
        <div className="h-4 w-px bg-slate-200" />
        <nav className="flex items-center gap-1 min-w-0">
          <span className="text-[13px] font-medium text-slate-400">
            {portalType === 'siteadmin' ? 'Site Admin' : 'EXIM'}
          </span>
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} />
              <span className={cn(
                'text-[13px]',
                i === breadcrumbs.length - 1 ? 'font-semibold text-slate-800' : 'font-medium text-slate-400',
              )}>
                {crumb}
              </span>
            </span>
          ))}
        </nav>
      </div>

      {/* User */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 rounded-full p-1 transition-all duration-150 hover:bg-slate-100/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 cursor-pointer">
            <Avatar className="h-8 w-8 ring-2 ring-slate-100">
              <AvatarFallback className="bg-gradient-to-br from-primary-500 to-primary-700 text-[11px] font-bold text-white">
                <User className="h-3.5 w-3.5" strokeWidth={2.5} />
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 bg-white border border-slate-200 shadow-xl shadow-black/5 rounded-lg p-1 z-[100]">
          <DropdownMenuLabel className="text-xs text-slate-500 font-medium px-2 py-1.5">My Account</DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-slate-100 h-px my-1 -mx-1" />
          <DropdownMenuItem onClick={() => navigate(portalType === 'siteadmin' ? '/siteadmin/dashboard' : '/admin/configure/automation')} className="flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-slate-50 focus:bg-slate-50 text-slate-700">
            <Settings className="h-4 w-4 text-slate-400" />
            <span>Settings</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-slate-100 h-px my-1 -mx-1" />
          <DropdownMenuItem onClick={handleLogout} className="flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-red-50 focus:bg-red-50 text-red-600">
            <LogOut className="h-4 w-4" />
            <span>Sign out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
