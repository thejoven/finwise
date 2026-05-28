import * as React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthGate } from "@/components/AuthGate";
import { AppShell } from "@/components/layout/AppShell";
import { clearToken, getToken } from "@/lib/api";
import { DashboardPage } from "@/pages/Dashboard";
import { SignalsPage } from "@/pages/Signals";
import { SignalDetailPage } from "@/pages/SignalDetail";
import { CommitmentsPage } from "@/pages/Commitments";
import { HoldingsPage } from "@/pages/Holdings";
import { RetrospectsPage } from "@/pages/Retrospects";
import { RefinementsPage } from "@/pages/Refinements";
import { GatePage } from "@/pages/Gate";
import { MetricsPage } from "@/pages/Metrics";
import { SettingsPage } from "@/pages/Settings";

export default function App() {
  const [signedIn, setSignedIn] = React.useState<boolean>(() => !!getToken());

  if (!signedIn) {
    return <AuthGate onSignedIn={() => setSignedIn(true)} />;
  }

  const handleSignOut = () => {
    clearToken();
    setSignedIn(false);
  };

  return (
    <Routes>
      <Route element={<AppShell onSignOut={handleSignOut} />}>
        <Route index element={<DashboardPage />} />
        <Route path="/signals" element={<SignalsPage />} />
        <Route path="/signals/:id" element={<SignalDetailPage />} />
        <Route path="/refinements" element={<RefinementsPage />} />
        <Route path="/gate" element={<GatePage />} />
        <Route path="/commitments" element={<CommitmentsPage />} />
        <Route path="/holdings" element={<HoldingsPage />} />
        <Route path="/retrospects" element={<RetrospectsPage />} />
        <Route path="/metrics" element={<MetricsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
