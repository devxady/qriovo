import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminRoute, ProtectedRoute, PublicOnlyRoute, SuperAdminRoute } from './components/RouteGuards.jsx'
import { SEOManager } from './components/SEOManager.jsx'
import { AdminLayout } from './components/AdminLayout.jsx'
import { SiteLayout } from './components/SiteLayout.jsx'
import { AdminActivityPage, AdminAnalyticsPage, AdminDashboardPage, AdminUserDetailPage, AdminUsersPage } from './pages/AdminPages.jsx'
import { SuperAdminSettingsPage } from './pages/AdminManagementPages.jsx'
import { AuthPage } from './pages/AuthPage.jsx'
import { InfoPage, LegalPage } from './pages/ContentPages.jsx'
import { DashboardPage } from './pages/DashboardPage.jsx'
import { EditQrPage } from './pages/EditQrPage.jsx'
import { GeneratorPage } from './pages/GeneratorPage.jsx'
import { HomePage } from './pages/HomePage.jsx'
import { NotFoundPage } from './pages/NotFoundPage.jsx'

export default function App() {
  return (
    <>
      <SEOManager />
      <Routes>
        <Route element={<SiteLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/generator" element={<GeneratorPage />} />
          <Route path="/login" element={<PublicOnlyRoute><AuthPage mode="login" /></PublicOnlyRoute>} />
          <Route path="/register" element={<PublicOnlyRoute><AuthPage mode="register" /></PublicOnlyRoute>} />
          <Route path="/about" element={<InfoPage page="about" />} />
          <Route path="/contact" element={<InfoPage page="contact" />} />
          <Route path="/privacy-policy" element={<LegalPage page="privacy" />} />
          <Route path="/terms-and-conditions" element={<LegalPage page="terms" />} />
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/dashboard/qr/:id/edit" element={<ProtectedRoute><EditQrPage /></ProtectedRoute>} />
          <Route path="/404" element={<NotFoundPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="/admin/users/create" element={<Navigate to="/admin/users" replace />} />
        <Route element={<AdminRoute><AdminLayout /></AdminRoute>}>
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/users/:uid" element={<AdminUserDetailPage />} />
          <Route path="/admin/activity" element={<AdminActivityPage />} />
          <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />
          <Route path="/admin/settings" element={<SuperAdminRoute><SuperAdminSettingsPage /></SuperAdminRoute>} />
          <Route path="/admin/roles" element={<Navigate to="/admin/settings" replace />} />
          <Route path="/admin/super-admin-settings" element={<Navigate to="/admin/settings" replace />} />
        </Route>
        <Route path="/home" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
