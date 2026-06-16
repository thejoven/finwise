import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loading, ErrorBox } from "@/components/QueryState";
import { wiseflow } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Cpu, Rss } from "lucide-react";

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-bold leading-none tabular-nums">{value}</p>
      {sub && <p className="mt-1.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function FunnelRow({
  label,
  count,
  pct,
}: {
  label: string;
  count: number;
  pct: number;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(100, Math.max(pct, 1.5))}%` }}
        />
      </div>
      <span className="w-24 shrink-0 text-right tabular-nums">
        {count} · {pct}%
      </span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      {value}
    </div>
  );
}

export function DashboardPage() {
  const overview = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: wiseflow.admin.stats.overview,
    refetchInterval: 30_000,
  });
  const health = useQuery({
    queryKey: ["admin", "inference-health"],
    queryFn: wiseflow.admin.inference.health,
    refetchInterval: 30_000,
  });
  const sys = useQuery({
    queryKey: ["dashboard-health"],
    queryFn: wiseflow.health,
    refetchInterval: 15_000,
  });

  const o = overview.data;
  const base = o?.pipeline.signals_30d ?? 0;
  const pct = (n: number) => (base > 0 ? Math.round((n / base) * 100) : 0);

  return (
    <div>
      <PageHeader
        title="系统总览"
        description="跨用户全局视图 · 实时透传 Postgres。"
        actions={
          sys.data?.status === "ok" ? (
            <Badge variant="success">backend healthy</Badge>
          ) : (
            <Badge variant="destructive">backend issue</Badge>
          )
        }
      />

      {overview.isLoading && <Loading />}
      {overview.isError && <ErrorBox error={overview.error} />}

      {o && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            <Stat
              label="用户总数"
              value={o.users.total}
              sub={`7 日活跃 ${o.users.active_7d} · 管理员 ${o.users.admins}`}
            />
            <Stat label="今日信号" value={o.signals.today} sub={`累计 ${o.signals.total}`} />
            <Stat
              label="今日推文采集"
              value={o.tweets.today}
              sub={`累计 ${o.tweets.total}`}
            />
            <Stat
              label="过会率 · 30天"
              value={`${Math.round(o.gate_pass_rate_30d * 100)}%`}
              sub={`${o.pipeline.gate_passed}/${o.pipeline.gate_total} 通过`}
            />
            <Stat label="待推断" value={o.signals.pending} />
            <Stat label="失败推断" value={o.signals.failed} />
            <Stat label="活跃持仓" value={o.pipeline.holdings_active} />
            <Stat
              label="订阅账号"
              value={o.subscriptions.accounts}
              sub={`${o.subscriptions.active_subs} 个活跃订阅`}
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>研判漏斗 · 近 30 天</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <FunnelRow label="信号" count={o.pipeline.signals_30d} pct={pct(o.pipeline.signals_30d)} />
                <FunnelRow label="追问完成" count={o.pipeline.refine_done} pct={pct(o.pipeline.refine_done)} />
                <FunnelRow label="降噪" count={o.pipeline.distilled} pct={pct(o.pipeline.distilled)} />
                <FunnelRow label="过会" count={o.pipeline.gate_passed} pct={pct(o.pipeline.gate_passed)} />
                <FunnelRow label="承诺签字" count={o.pipeline.signed} pct={pct(o.pipeline.signed)} />
                <FunnelRow label="持仓" count={o.pipeline.holdings_active} pct={pct(o.pipeline.holdings_active)} />
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Cpu className="h-4 w-4" />
                    AI 推断健康
                  </CardTitle>
                  <Link to="/inference" className="text-xs text-primary hover:underline">
                    详情 →
                  </Link>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row
                    label="待处理"
                    value={
                      <Badge variant={health.data && health.data.pending > 0 ? "warning" : "outline"}>
                        {health.data?.pending ?? "—"}
                      </Badge>
                    }
                  />
                  <Row
                    label="失败"
                    value={
                      <Badge variant={health.data && health.data.failed > 0 ? "destructive" : "outline"}>
                        {health.data?.failed ?? "—"}
                      </Badge>
                    }
                  />
                  <Row label="已完成" value={<span className="tabular-nums">{health.data?.done ?? "—"}</span>} />
                  <Row
                    label="平均时延"
                    value={<span className="tabular-nums">{health.data ? `${health.data.avg_latency_seconds}s` : "—"}</span>}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Rss className="h-4 w-4" />
                    订阅轮询
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row label="订阅账号" value={<span className="tabular-nums">{o.subscriptions.accounts}</span>} />
                  <Row label="活跃订阅" value={<span className="tabular-nums">{o.subscriptions.active_subs}</span>} />
                  <Row
                    label="上次轮询"
                    value={
                      <span className="text-xs text-muted-foreground">
                        {o.subscriptions.poller_last_at ? formatDate(o.subscriptions.poller_last_at) : "—"}
                      </span>
                    }
                  />
                  <Row
                    label="推文分类失败"
                    value={
                      <Badge variant={o.tweets.classify_failed > 0 ? "destructive" : "outline"}>
                        {o.tweets.classify_failed}
                      </Badge>
                    }
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
