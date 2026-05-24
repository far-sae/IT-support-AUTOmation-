import { Navigate, Route, Routes } from "react-router-dom";

import { ProtectedRoute } from "./auth/ProtectedRoute.js";
import LoginPage from "./auth/LoginPage.js";
import RegisterPage from "./auth/RegisterPage.js";
import OAuthCallback from "./auth/OAuthCallback.js";
import InvitePage from "./auth/InvitePage.js";

import { AppShell } from "./components/AppShell.js";

import DashboardPage from "./pages/DashboardPage.js";
import TicketsPage from "./pages/tickets/TicketsPage.js";
import TicketDetailPage from "./pages/tickets/TicketDetailPage.js";
import RemotePage from "./pages/RemotePage.js";
import AssetsPage from "./pages/AssetsPage.js";
import KnowledgePage from "./pages/KnowledgePage.js";
import UsersPage from "./pages/UsersPage.js";
import IncidentsPage from "./pages/IncidentsPage.js";
import ReportsPage from "./pages/ReportsPage.js";
import OrgSettingsPage from "./pages/OrgSettingsPage.js";
import DetectionsPage from "./pages/DetectionsPage.js";
import WorkflowsPage from "./pages/WorkflowsPage.js";
import MlPage from "./pages/MlPage.js";
import ThreatIntelPage from "./pages/ThreatIntelPage.js";
import DefenderPage from "./pages/DefenderPage.js";
import AttackCoveragePage from "./pages/AttackCoveragePage.js";
import PlatformPage from "./pages/PlatformPage.js";
import StatusPage from "./pages/StatusPage.js";
import SurveyPage from "./pages/SurveyPage.js";
import { useAuth } from "./auth/AuthProvider.js";

function HomeRedirect() {
  const { user, org, status } = useAuth();
  if (status === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-ink/60">Loading…</div>;
  }
  if (!user || !org) return <Navigate to="/login" replace />;
  return <Navigate to={`/app/${org.slug}/dashboard`} replace />;
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/:orgSlug" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/auth/callback" element={<OAuthCallback />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/status/:orgSlug" element={<StatusPage />} />
      <Route path="/survey/:token" element={<SurveyPage />} />

      {/* Platform admin */}
      <Route
        path="/platform"
        element={
          <ProtectedRoute platformOnly>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<PlatformPage />} />
      </Route>

      {/* Authenticated, tenant-prefixed */}
      <Route
        path="/app/:orgSlug"
        element={
          <ProtectedRoute matchOrgSlug>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="tickets/:id" element={<TicketDetailPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />

        <Route
          path="remote"
          element={<ProtectedRoute allow={["AGENT", "ADMIN"]} matchOrgSlug><RemotePage /></ProtectedRoute>}
        />
        <Route
          path="assets"
          element={<ProtectedRoute allow={["AGENT", "ADMIN"]} matchOrgSlug><AssetsPage /></ProtectedRoute>}
        />

        <Route
          path="users"
          element={<ProtectedRoute allow={["ADMIN"]} matchOrgSlug><UsersPage /></ProtectedRoute>}
        />
        <Route
          path="incidents"
          element={<ProtectedRoute allow={["ADMIN"]} matchOrgSlug><IncidentsPage /></ProtectedRoute>}
        />
        <Route
          path="reports"
          element={<ProtectedRoute allow={["ADMIN"]} matchOrgSlug><ReportsPage /></ProtectedRoute>}
        />
        <Route
          path="settings"
          element={<ProtectedRoute allow={["ADMIN"]} matchOrgSlug><OrgSettingsPage /></ProtectedRoute>}
        />
        <Route
          path="detections"
          element={<ProtectedRoute allow={["AGENT", "ADMIN"]} matchOrgSlug><DetectionsPage /></ProtectedRoute>}
        />
        <Route
          path="workflows"
          element={<ProtectedRoute allow={["AGENT", "ADMIN"]} matchOrgSlug><WorkflowsPage /></ProtectedRoute>}
        />
        <Route
          path="ml"
          element={<ProtectedRoute allow={["ADMIN"]} matchOrgSlug><MlPage /></ProtectedRoute>}
        />
        <Route
          path="threat"
          element={<ProtectedRoute allow={["AGENT", "ADMIN"]} matchOrgSlug><ThreatIntelPage /></ProtectedRoute>}
        />
        <Route
          path="defender"
          element={<ProtectedRoute allow={["AGENT", "ADMIN"]} matchOrgSlug><DefenderPage /></ProtectedRoute>}
        />
        <Route
          path="attack"
          element={<ProtectedRoute allow={["AGENT", "ADMIN"]} matchOrgSlug><AttackCoveragePage /></ProtectedRoute>}
        />
      </Route>

      {/* Root + catch-all */}
      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}
