import AppHeader from './AppHeader.jsx'

/**
 * AppShell — wraps every authenticated page with sidebar + header + content area.
 * Uses proper scroll containment: sidebar and header stay fixed,
 * only the content area scrolls.
 *
 * Usage:
 *   <AppShell sidebar={<CompanySidebar />}>
 *     <PageHeader title="..." />
 *     {children}
 *   </AppShell>
 */
export default function AppShell({ children, sidebar, portalType = 'company' }) {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {sidebar}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <AppHeader portalType={portalType} />
        <main className="flex-1 overflow-auto p-5 lg:p-6">
          <div className="exim-fade-in mx-auto max-w-[1600px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
