import * as React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { AUTH_EXPIRED_EVENT, clearToken, wiseflow, getToken } from "@/lib/api";
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
import { UsersPage } from "@/pages/Users";
import { InvitesPage } from "@/pages/Invites";

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      {children}
    </div>
  );
}

// 非管理员持有有效 session 时落到这里 (例如用 app 账号访问后台). 给登出口.
function AdminOnly({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <FullScreen>
      <div className="w-full max-w-md space-y-4 rounded-lg border p-6 text-center">
        <h1 className="text-lg font-semibold">仅管理员可访问</h1>
        <p className="text-sm text-muted-foreground">
          当前账号 <span className="font-mono">{email}</span> 不是管理员, 无权进入后台.
        </p>
        <Button variant="outline" onClick={onSignOut}>
          退出登录
        </Button>
      </div>
    </FullScreen>
  );
}

export default function App() {
  const qc = useQueryClient();
  const [hasToken, setHasToken] = React.useState<boolean>(() => !!getToken());

  // 任意已认证请求 401 → api 层清 token 并派发事件 → 回登录页.
  React.useEffect(() => {
    const onExpired = () => {
      setHasToken(false);
      qc.clear();
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [qc]);

  // 引导查询: 有 token 才查当前用户身份 (含 is_admin).
  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: wiseflow.me,
    enabled: hasToken,
    retry: false,
    staleTime: 60_000,
  });

  const handleSignedIn = () => {
    setHasToken(true);
    qc.invalidateQueries({ queryKey: ["me"] });
  };

  const handleSignOut = () => {
    void wiseflow.auth.logout().catch(() => {}); // 尽力吊销 server session, 失败忽略
    clearToken();
    qc.clear();
    setHasToken(false);
  };

  if (!hasToken) {
    return <AuthGate onSignedIn={handleSignedIn} />;
  }

  if (meQ.isLoading) {
    return (
      <FullScreen>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 正在验证身份…
        </div>
      </FullScreen>
    );
  }

  // token 失效/网络错: 401 已被 api 层处理回登录; 其它错误也退回登录页重试.
  if (meQ.isError || !meQ.data) {
    return <AuthGate onSignedIn={handleSignedIn} />;
  }

  if (!meQ.data.is_admin) {
    return <AdminOnly email={meQ.data.email} onSignOut={handleSignOut} />;
  }

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
        <Route path="/users" element={<UsersPage />} />
        <Route path="/invites" element={<InvitesPage />} />
        <Route path="/metrics" element={<MetricsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
