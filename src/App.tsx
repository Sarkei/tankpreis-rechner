import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/AuthContext.tsx";
import Shell from "./components/layout/Shell.tsx";
import { SkeletonCard } from "./components/ui/index.tsx";

const LoginPage = lazy(() => import("./pages/LoginPage.tsx"));
const RegisterPage = lazy(() => import("./pages/RegisterPage.tsx"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage.tsx"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage.tsx"));
const DashboardPage = lazy(() => import("./pages/DashboardPage.tsx"));
const VehiclesPage = lazy(() => import("./pages/VehiclesPage.tsx"));
const GroupsPage = lazy(() => import("./pages/GroupsPage.tsx"));
const GroupDetailPage = lazy(() => import("./pages/GroupDetailPage.tsx"));
const JoinGroupPage = lazy(() => import("./pages/JoinGroupPage.tsx"));
const TripsPage = lazy(() => import("./pages/TripsPage.tsx"));
const PaymentsPage = lazy(() => import("./pages/PaymentsPage.tsx"));
const StatsPage = lazy(() => import("./pages/StatsPage.tsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.tsx"));

function LoadingFallback() {
  return (
    <div className="space-y-4 p-4">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingFallback />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-zinc-500 text-sm">Lädt…</p>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        {/* Public */}
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/register" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/join" element={<JoinGroupPage />} />

        {/* Private */}
        <Route path="/" element={<PrivateRoute><Shell><DashboardPage /></Shell></PrivateRoute>} />
        <Route path="/vehicles" element={<PrivateRoute><Shell><VehiclesPage /></Shell></PrivateRoute>} />
        <Route path="/groups" element={<PrivateRoute><Shell><GroupsPage /></Shell></PrivateRoute>} />
        <Route path="/groups/:id" element={<PrivateRoute><Shell><GroupDetailPage /></Shell></PrivateRoute>} />
        <Route path="/trips" element={<PrivateRoute><Shell><TripsPage /></Shell></PrivateRoute>} />
        <Route path="/payments" element={<PrivateRoute><Shell><PaymentsPage /></Shell></PrivateRoute>} />
        <Route path="/stats" element={<PrivateRoute><Shell><StatsPage /></Shell></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute><Shell><SettingsPage /></Shell></PrivateRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
