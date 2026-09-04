import { useNavigate } from 'react-router-dom'
import { Building2, Server, CreditCard, ArrowRight } from 'lucide-react'
import SiteAdminSidebar from '../../components/siteadmin/sidebar.jsx'
import AppShell from '../../components/layout/AppShell.jsx'
import PageHeader from '../../components/common/PageHeader.jsx'
import StatCard from '../../components/common/StatCard.jsx'

export default function SiteAdminDashboardPage() {
  const navigate = useNavigate()

  return (
    <AppShell sidebar={<SiteAdminSidebar />} portalType="siteadmin">
      <PageHeader
        title="Site Admin Dashboard"
        description="Manage companies, billing, and system operations"
      />

      <div className="flex flex-wrap gap-4 mb-8">
        <StatCard
          title="System Status"
          value="Online"
          subtitle="All services running seamlessly"
          icon={<Server size={22} />}
          color="#10B981" // emerald-500
          className="w-full max-w-[320px]"
        />
      </div>

      {/* Quick Actions Panel */}
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-5">
          Quick Actions
        </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { 
            key: 'companies', 
            icon: <Building2 size={22} className="text-blue-600" />, 
            title: 'Companies', 
            description: 'Create and manage company accounts', 
            path: '/siteadmin/company', 
            bg: 'bg-blue-50' 
          },
          { 
            key: 'billing', 
            icon: <CreditCard size={22} className="text-emerald-600" />, 
            title: 'Billing', 
            description: 'Manage billing and invoices', 
            path: '/siteadmin/billing', 
            bg: 'bg-emerald-50' 
          },
        ].map((action) => (
          <div
            key={action.key}
            onClick={() => navigate(action.path)}
            className="group bg-slate-50 border border-slate-200 rounded-lg p-5 cursor-pointer transition-colors duration-200 hover:bg-slate-100 hover:border-slate-300 flex items-start gap-4"
          >
            <div className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${action.bg}`}>
              {action.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-slate-800 mb-1 flex items-center justify-between">
                {action.title}
                <ArrowRight size={14} className="text-slate-400 group-hover:text-blue-500 transition-colors" />
              </div>
              <div className="text-[13px] text-slate-500 leading-relaxed">{action.description}</div>
            </div>
          </div>
        ))}
        </div>
      </div>
    </AppShell>
  )
}
