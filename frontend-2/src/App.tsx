import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import {
  SiteAdminBillingPage,
  SiteAdminCompanyPage,
  SiteAdminDashboardPage,
  SiteAdminLoginPage,
  SiteAdminViewBillesPage,
} from './pages/siteadmin/index.jsx'
import {
  CompanyAdminDashboardPage,
  CompanyLoginPage,
  CompanyAdminUploadPage,
  CompanyAdminSalesDataCleanPage,
  CompanyAdminCombinationPage,
  CompanyAdminConnectCombinationPage,
  CompanyAdminStartProcessPage,
  CompanyAdminManualProcessMatchPage,
  CompanyAdminInvPage,
  CompanyAdminUploadPdfPage,
  CompanyAdminFetchPdfDataPage,
  CompanyAdminUploadSalesPage,
  CompanyAdminFetchFromSapSalesPage,
  CompanyAdminSbPage,
  CompanyAdminReportsPage,
  CompanyAdminSbBatchPage,
  CompanyAdminDgftPage,
  CompanyAdminDgftManualPage,
  CompanyAdminDgftExcelPage,
  CompanyAdminDgftExcelToProcessPage,
  CompanyAdminDgftPdfPage,
  CompanyAdminEbrcBulkDownloadPage,
  CompanyAdminStoreBulkDownloadPage,
  CompanyAdminJvDbkFormatPage,
  CompanyAdminJvDbkPage,
  CompanyAdminJvRodtpFormatPage,
  CompanyAdminJvRodtpPage,
  CompanyAdminReportTemplatesPage,
  CompanyAdminChaPage,
  CompanyAdminConfigurePdfPage,
  CompanyAdminConfigureDgftPage,
  CompanyAdminConfigureSalesPage,
  CompanyAdminConfigureChaPage,
  CompanyAdminConfigureAutomationPage,
  CompanyAdminConfigureAutomationLogsPage,
  CompanyAdminUsersPage,
} from './pages/company/index.jsx'

const protectedRoutes: Array<{ path: string; element: ReactNode }> = [
  { path: '/siteadmin/dashboard', element: <SiteAdminDashboardPage /> },
  { path: '/siteadmin/company', element: <SiteAdminCompanyPage /> },
  { path: '/siteadmin/billing', element: <SiteAdminBillingPage /> },
  { path: '/siteadmin/view-billes', element: <SiteAdminViewBillesPage /> },
]

function ProtectedRoute({ children }: { children: ReactNode }) {
  const isAuthenticated = localStorage.getItem('siteadmin_authenticated') === 'true'

  if (!isAuthenticated) {
    return <Navigate to="/siteadmin/login" replace />
  }

  return children
}

function CompanyProtectedRoute({ children }: { children: ReactNode }) {
  const isAuthenticated = localStorage.getItem('company_authenticated') === 'true'

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/siteadmin/login" element={<SiteAdminLoginPage />} />
      <Route path="/login" element={<CompanyLoginPage />} />
      {protectedRoutes.map((route) => (
        <Route
          key={route.path}
          path={route.path}
          element={<ProtectedRoute>{route.element}</ProtectedRoute>}
        />
      ))}
      <Route
        path="/admin/dashboard"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminDashboardPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/header-mapping"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminUploadPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/sales-data-clean"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminSalesDataCleanPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/combination"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminCombinationPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/connect-combination"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminConnectCombinationPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/start-process"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminStartProcessPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/manual-process-match"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminManualProcessMatchPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/inv"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminInvPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/upload-pdf"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminUploadPdfPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/fetch-pdf-data"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminFetchPdfDataPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/upload-sales"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminUploadSalesPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/fetch-from-sap-sales"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminFetchFromSapSalesPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/sb"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminSbPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/reports"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminReportsPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/reports/templates"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminReportTemplatesPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/sb-batch"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminSbBatchPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/dgft/manual"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminDgftManualPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/dgft/excel"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminDgftExcelPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/dgft/excel-to-process"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminDgftExcelToProcessPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/dgft"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminDgftPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/pdf/dgft"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminDgftPdfPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/ebrc-bulk-download"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminEbrcBulkDownloadPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/store-bulk-download"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminStoreBulkDownloadPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/jv-dbks-format"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminJvDbkFormatPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/jv-dbk"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminJvDbkPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/jv-rodtp-format"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminJvRodtpFormatPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/jv-rodtp"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminJvRodtpPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/cha/process"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminChaPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/configure/pdf"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminConfigurePdfPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/configure/dgft"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminConfigureDgftPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/configure/sales"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminConfigureSalesPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/configure/cha"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminConfigureChaPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/configure/automation"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminConfigureAutomationPage />
          </CompanyProtectedRoute>
        }
      />
      <Route
        path="/admin/configure/automation-logs"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminConfigureAutomationLogsPage />
          </CompanyProtectedRoute>
        }
      />

      <Route
        path="/admin/users"
        element={
          <CompanyProtectedRoute>
            <CompanyAdminUsersPage />
          </CompanyProtectedRoute>
        }
      />
      <Route path="/admin/cha/config" element={<Navigate to="/admin/configure/cha" replace />} />
      <Route path="/admin/cha/otp" element={<Navigate to="/admin/configure/cha" replace />} />

      <Route path="*" element={<Navigate to="/siteadmin/login" replace />} />
    </Routes>
  )
}
