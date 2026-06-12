import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { wiseflow } from "@/lib/api";
import { Loading, ErrorBox } from "@/components/QueryState";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, ClipboardCheck, Inbox, Briefcase, History } from "lucide-react";

function CountCard({
  title,
  count,
  href,
  hint,
  icon: Icon,
}: {
  title: string;
  count: number | string;
  href: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link to={href}>
      <Card className="transition-colors hover:bg-accent">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div>
            <CardDescription>{title}</CardDescription>
            <CardTitle className="mt-1 text-3xl font-semibold">{count}</CardTitle>
          </div>
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{hint}</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </CardContent>
      </Card>
    </Link>
  );
}

export function DashboardPage() {
  const {
    data: signalsData,
    isLoading: signalsLoading,
    isError: signalsIsError,
    error: signalsError,
  } = useQuery({
    queryKey: ["signals"],
    queryFn: () => wiseflow.signals.list(),
  });
  const {
    data: commitmentsData,
    isLoading: commitmentsLoading,
    isError: commitmentsIsError,
  } = useQuery({
    queryKey: ["commitments-active"],
    queryFn: wiseflow.commitments.active,
  });
  const {
    data: holdingsData,
    isLoading: holdingsLoading,
    isError: holdingsIsError,
  } = useQuery({
    queryKey: ["holdings-active"],
    queryFn: wiseflow.holdings.active,
  });
  const {
    data: retrospectsData,
    isLoading: retrospectsLoading,
    isError: retrospectsIsError,
  } = useQuery({
    queryKey: ["retrospects"],
    queryFn: wiseflow.retrospects.list,
  });
  const { data: healthData } = useQuery({
    queryKey: ["dashboard-health"],
    queryFn: wiseflow.health,
    refetchInterval: 10_000,
  });

  return (
    <div>
      <PageHeader
        title="概览"
        description="wiseflow 后台. 数据走 /v1/* 端点, 实时透传 Postgres + NATS 状态."
        actions={
          healthData?.status === "ok" ? (
            <Badge variant="success">backend healthy</Badge>
          ) : (
            <Badge variant="destructive">backend issue</Badge>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CountCard
          title="Signals 总数"
          count={
            signalsLoading
              ? "…"
              : signalsIsError
              ? "—"
              : (signalsData?.signals.length ?? 0)
          }
          href="/signals"
          hint="原始信号事件"
          icon={Inbox}
        />
        <CountCard
          title="活跃 Commitments"
          count={
            commitmentsLoading
              ? "…"
              : commitmentsIsError
              ? "—"
              : commitmentsData
              ? 1
              : 0
          }
          href="/commitments"
          hint="待签字 / 已签字"
          icon={ClipboardCheck}
        />
        <CountCard
          title="活跃 Holdings"
          count={
            holdingsLoading
              ? "…"
              : holdingsIsError
              ? "—"
              : holdingsData
              ? 1
              : 0
          }
          href="/holdings"
          hint="陪伴中持仓"
          icon={Briefcase}
        />
        <CountCard
          title="复盘 Retrospects"
          count={
            retrospectsLoading
              ? "…"
              : retrospectsIsError
              ? "—"
              : (retrospectsData?.retrospects.length ?? 0)
          }
          href="/retrospects"
          hint="所有训练"
          icon={History}
        />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>最近 5 条信号</CardTitle>
            <CardDescription>按 captured_at 倒序</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {signalsLoading && <Loading />}
            {signalsIsError && <ErrorBox error={signalsError} />}
            {signalsData &&
              signalsData.signals.slice(0, 5).map((s) => (
                <Link
                  key={s.id}
                  to={`/signals/${s.id}`}
                  className="block rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-muted-foreground">
                      {s.id.slice(0, 8)}
                    </span>
                    <Badge
                      variant={
                        s.inference_status === "done"
                          ? "success"
                          : s.inference_status === "failed"
                          ? "destructive"
                          : "warning"
                      }
                    >
                      {s.inference_status}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm">{s.raw_text}</p>
                </Link>
              ))}
            {signalsData && signalsData.signals.length === 0 && (
              <p className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
                暂无信号
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>系统</CardTitle>
            <CardDescription>healthz 探测</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">backend status</span>
              <span className="font-mono">{healthData?.status ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">db</span>
              <span className="font-mono">{healthData?.db ?? "ok"}</span>
            </div>
            <div className="mt-4 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p>路线图: Phase 1 (安静) · M1 数据底座 → M4 端到端.</p>
              <p className="mt-1">
                后端跑在 <span className="font-mono">root@192.168.1.205</span>,
                见 SERVER.md.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
