import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ArrowDown, Check, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ErrorBox, Loading } from "@/components/QueryState";
import { wiseflow } from "@/lib/api";
import { formatDate } from "@/lib/utils";

export function SignalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ["signal", id],
    queryFn: () => wiseflow.signals.get(id!),
    enabled: !!id,
  });

  return (
    <div>
      <PageHeader
        title="Signal"
        description={id}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/signals">
              <ChevronLeft className="h-3.5 w-3.5" /> 返回列表
            </Link>
          </Button>
        }
      />

      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} />}
      {q.data && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Raw text</CardTitle>
              <CardDescription>原始记录 — 不可改, append-only.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-4 text-sm">
                {q.data.raw_text}
              </p>
              <Separator className="my-4" />
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <Field label="signal_id" value={q.data.id} mono />
                <Field label="user_id" value={q.data.user_id} mono />
                <Field label="captured_at" value={formatDate(q.data.captured_at)} />
                <Field label="created_at" value={formatDate(q.data.created_at)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inference</CardTitle>
              <CardDescription>由 Mastra / analyst agent 推回.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">status</span>
                <Badge
                  variant={
                    q.data.inference_status === "done"
                      ? "success"
                      : q.data.inference_status === "failed"
                      ? "destructive"
                      : "warning"
                  }
                >
                  {q.data.inference_status}
                </Badge>
              </div>
              <div>
                <p className="mb-1 text-muted-foreground">summary</p>
                <p className="rounded-md border bg-muted/30 p-2 text-xs">
                  {q.data.inference_summary || "—"}
                </p>
              </div>
              <div>
                <p className="mb-1 text-muted-foreground">tags</p>
                <div className="flex flex-wrap gap-1">
                  {(q.data.inference_tags ?? []).map((t) => (
                    <Badge key={t} variant="outline">
                      {t}
                    </Badge>
                  ))}
                  {(q.data.inference_tags ?? []).length === 0 && (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="lg:col-span-3">
            <SignalChain signalId={q.data.id} />
          </div>
        </div>
      )}
    </div>
  );
}

// SignalChain 顺着 signal → refinement → evaluation → commitment → holding → retrospect
// 逐级查询, 每段展示关键详情. 任一段没有 (404) 就标"未产生", 链路到此为止.
function SignalChain({ signalId }: { signalId: string }) {
  const refine = useQuery({
    queryKey: ["chain", "refine", signalId],
    queryFn: () => wiseflow.refinement.bySignal(signalId),
    retry: 0,
  });
  const refId = refine.data?.id;

  const evalQ = useQuery({
    queryKey: ["chain", "eval", refId],
    queryFn: () => wiseflow.gate.byRefinement(refId!),
    enabled: !!refId,
    retry: 0,
  });
  const evalId = evalQ.data?.id;

  const commitQ = useQuery({
    queryKey: ["chain", "commit", evalId],
    queryFn: () => wiseflow.commitments.byEvaluation(evalId!),
    enabled: !!evalId,
    retry: 0,
  });
  const commitId = commitQ.data?.id;

  const holdingQ = useQuery({
    queryKey: ["chain", "holding", commitId],
    queryFn: () => wiseflow.holdings.get(commitId!),
    enabled: !!commitId,
    retry: 0,
  });

  const retroQ = useQuery({
    queryKey: ["retrospects"],
    queryFn: wiseflow.retrospects.list,
    enabled: !!commitId,
  });
  const retro = commitId
    ? retroQ.data?.retrospects.find((r) => r.commitment_id === commitId)
    : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>全链路 Pipeline</CardTitle>
        <CardDescription>
          这条信号在 追问 → 评审 → 承诺 → 持仓 → 复盘 各环节的去向. 点 ID 跳到对应页.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Stage
          label="追问 Refinement"
          to="/refinements"
          loading={refine.isLoading}
          present={!!refine.data}
        >
          {refine.data && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={refine.data.status === "completed" ? "success" : "warning"}>
                {refine.data.status}
              </Badge>
              <span className="text-muted-foreground">{refine.data.rounds_done}/5 轮</span>
              {refine.data.decision && <Badge variant="outline">{refine.data.decision}</Badge>}
              <code className="ml-auto text-[11px] text-muted-foreground">
                {refine.data.id.slice(0, 8)}…
              </code>
            </div>
          )}
        </Stage>

        <Arrow />

        <Stage
          label="评审 Gate"
          to="/gate"
          loading={evalQ.isLoading}
          present={!!evalQ.data}
          waiting={!refId}
        >
          {evalQ.data && (
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2">
                {evalQ.data.passed ? (
                  <Badge variant="success">四门通过</Badge>
                ) : (
                  <Badge variant="destructive">第 {evalQ.data.failed_gate} 门未过</Badge>
                )}
                {evalQ.data.archived_pool && (
                  <Badge variant="outline">{evalQ.data.archived_pool}</Badge>
                )}
                <code className="ml-auto text-[11px] text-muted-foreground">
                  {evalQ.data.id.slice(0, 8)}…
                </code>
              </div>
              {evalQ.data.gates && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {[
                    ["佐证", evalQ.data.gates.g1_thickness.pass],
                    ["共识", evalQ.data.gates.g2_anti_consensus.pass],
                    ["时机", evalQ.data.gates.g3_window.pass],
                    ["能力圈", evalQ.data.gates.g4_edge.pass],
                  ].map(([l, ok]) => (
                    <span
                      key={l as string}
                      className={
                        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 " +
                        (ok
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : "bg-destructive/15 text-destructive")
                      }
                    >
                      {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                      {l as string}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </Stage>

        <Arrow />

        <Stage
          label="承诺 Commitment"
          to="/commitments"
          loading={commitQ.isLoading}
          present={!!commitQ.data}
          waiting={!evalId}
        >
          {commitQ.data?.thesis && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{commitQ.data.thesis.asset_ticker}</span>
              <span className="text-muted-foreground">
                {commitQ.data.thesis.action} · {commitQ.data.thesis.position_pct}% ·{" "}
                {commitQ.data.thesis.duration_months} 个月
              </span>
              <Badge variant={commitQ.data.status === "signed" ? "success" : "outline"}>
                {commitQ.data.status}
              </Badge>
              <code className="ml-auto text-[11px] text-muted-foreground">
                {commitQ.data.id.slice(0, 8)}…
              </code>
            </div>
          )}
        </Stage>

        <Arrow />

        <Stage
          label="持仓 Holding"
          to="/holdings"
          loading={holdingQ.isLoading}
          present={!!holdingQ.data}
          waiting={!commitId}
        >
          {holdingQ.data && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={holdingQ.data.status === "active" ? "success" : "outline"}>
                {holdingQ.data.status}
              </Badge>
              <span className="text-muted-foreground">
                到期 {formatDate(holdingQ.data.expires_at)}
              </span>
              <code className="ml-auto text-[11px] text-muted-foreground">
                {holdingQ.data.id.slice(0, 8)}…
              </code>
            </div>
          )}
        </Stage>

        <Arrow />

        <Stage
          label="复盘 Retrospect"
          to="/retrospects"
          loading={!!commitId && retroQ.isLoading}
          present={!!retro}
          waiting={!commitId}
        >
          {retro && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={retro.state === "finalized" ? "success" : "warning"}>
                {retro.state}
              </Badge>
              {retro.focus_dim && <span className="text-muted-foreground">{retro.focus_dim}</span>}
              <code className="ml-auto text-[11px] text-muted-foreground">
                {retro.id.slice(0, 8)}…
              </code>
            </div>
          )}
        </Stage>
      </CardContent>
    </Card>
  );
}

function Arrow() {
  return (
    <div className="flex justify-center">
      <ArrowDown className="h-4 w-4 text-muted-foreground/50" />
    </div>
  );
}

function Stage({
  label,
  to,
  loading,
  present,
  waiting,
  children,
}: {
  label: string;
  to: string;
  loading?: boolean;
  present?: boolean;
  waiting?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-1 flex items-center justify-between">
        <Link to={to} className="text-sm font-medium hover:text-primary hover:underline">
          {label}
        </Link>
        {loading ? (
          <span className="text-xs text-muted-foreground">查询中…</span>
        ) : present ? (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">已产生</span>
        ) : waiting ? (
          <span className="text-xs text-muted-foreground/60">等待上游</span>
        ) : (
          <span className="text-xs text-muted-foreground/60">未产生</span>
        )}
      </div>
      {present && children}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={mono ? "font-mono text-xs break-all" : "text-sm"}>{value}</p>
    </div>
  );
}
