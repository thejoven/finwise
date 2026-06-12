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
  const { data, isLoading, isError, error } = useQuery({
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

      {isLoading && <Loading />}
      {isError && <ErrorBox error={error} />}
      {data && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Raw text</CardTitle>
              <CardDescription>原始记录 — 不可改, append-only.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-4 text-sm">
                {data.raw_text}
              </p>
              <Separator className="my-4" />
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <Field label="signal_id" value={data.id} mono />
                <Field label="user_id" value={data.user_id} mono />
                <Field label="captured_at" value={formatDate(data.captured_at)} />
                <Field label="created_at" value={formatDate(data.created_at)} />
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
                    data.inference_status === "done"
                      ? "success"
                      : data.inference_status === "failed"
                      ? "destructive"
                      : "warning"
                  }
                >
                  {data.inference_status}
                </Badge>
              </div>
              <div>
                <p className="mb-1 text-muted-foreground">summary</p>
                <p className="rounded-md border bg-muted/30 p-2 text-xs">
                  {data.inference_summary || "—"}
                </p>
              </div>
              <div>
                <p className="mb-1 text-muted-foreground">tags</p>
                <div className="flex flex-wrap gap-1">
                  {(data.inference_tags ?? []).map((t) => (
                    <Badge key={t} variant="outline">
                      {t}
                    </Badge>
                  ))}
                  {(data.inference_tags ?? []).length === 0 && (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="lg:col-span-3">
            <SignalChain signalId={data.id} />
          </div>
        </div>
      )}
    </div>
  );
}

// SignalChain 顺着 signal → refinement → evaluation → commitment → holding → retrospect
// 逐级查询, 每段展示关键详情. 任一段没有 (404) 就标"未产生", 链路到此为止.
function SignalChain({ signalId }: { signalId: string }) {
  const { data: refine, isLoading: refineLoading } = useQuery({
    queryKey: ["chain", "refine", signalId],
    queryFn: () => wiseflow.refinement.bySignal(signalId),
    retry: 0,
  });
  const refId = refine?.id;

  const { data: evalData, isLoading: evalLoading } = useQuery({
    queryKey: ["chain", "eval", refId],
    queryFn: () => wiseflow.gate.byRefinement(refId!),
    enabled: !!refId,
    retry: 0,
  });
  const evalId = evalData?.id;

  const { data: commit, isLoading: commitLoading } = useQuery({
    queryKey: ["chain", "commit", evalId],
    queryFn: () => wiseflow.commitments.byEvaluation(evalId!),
    enabled: !!evalId,
    retry: 0,
  });
  const commitId = commit?.id;

  const { data: holding, isLoading: holdingLoading } = useQuery({
    queryKey: ["chain", "holding", commitId],
    queryFn: () => wiseflow.holdings.get(commitId!),
    enabled: !!commitId,
    retry: 0,
  });

  const { data: retroData, isLoading: retroLoading } = useQuery({
    queryKey: ["retrospects"],
    queryFn: wiseflow.retrospects.list,
    enabled: !!commitId,
  });
  const retro = commitId
    ? retroData?.retrospects.find((r) => r.commitment_id === commitId)
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
          loading={refineLoading}
          present={!!refine}
        >
          {refine && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={refine.status === "completed" ? "success" : "warning"}>
                {refine.status}
              </Badge>
              <span className="text-muted-foreground">{refine.rounds_done}/5 轮</span>
              {refine.decision && <Badge variant="outline">{refine.decision}</Badge>}
              <code className="ml-auto text-[11px] text-muted-foreground">
                {refine.id.slice(0, 8)}…
              </code>
            </div>
          )}
        </Stage>

        <Arrow />

        <Stage
          label="投决会"
          to="/gate"
          loading={evalLoading}
          present={!!evalData}
          waiting={!refId}
        >
          {evalData && (
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2">
                {evalData.passed ? (
                  <Badge variant="success">全票过会</Badge>
                ) : (
                  <Badge variant="destructive">第 {evalData.failed_gate} 位否决</Badge>
                )}
                {evalData.archived_pool && (
                  <Badge variant="outline">{evalData.archived_pool}</Badge>
                )}
                <code className="ml-auto text-[11px] text-muted-foreground">
                  {evalData.id.slice(0, 8)}…
                </code>
              </div>
              {evalData.gates && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {[
                    ["佐证", evalData.gates.g1_thickness.pass],
                    ["共识", evalData.gates.g2_anti_consensus.pass],
                    ["时机", evalData.gates.g3_window.pass],
                    ["能力圈", evalData.gates.g4_edge.pass],
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
          loading={commitLoading}
          present={!!commit}
          waiting={!evalId}
        >
          {commit?.thesis && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{commit.thesis.asset_ticker}</span>
              <span className="text-muted-foreground">
                {commit.thesis.action} · {commit.thesis.position_pct}% ·{" "}
                {commit.thesis.duration_months} 个月
              </span>
              <Badge variant={commit.status === "signed" ? "success" : "outline"}>
                {commit.status}
              </Badge>
              <code className="ml-auto text-[11px] text-muted-foreground">
                {commit.id.slice(0, 8)}…
              </code>
            </div>
          )}
        </Stage>

        <Arrow />

        <Stage
          label="持仓 Holding"
          to="/holdings"
          loading={holdingLoading}
          present={!!holding}
          waiting={!commitId}
        >
          {holding && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={holding.status === "active" ? "success" : "outline"}>
                {holding.status}
              </Badge>
              <span className="text-muted-foreground">
                到期 {formatDate(holding.expires_at)}
              </span>
              <code className="ml-auto text-[11px] text-muted-foreground">
                {holding.id.slice(0, 8)}…
              </code>
            </div>
          )}
        </Stage>

        <Arrow />

        <Stage
          label="复盘 Retrospect"
          to="/retrospects"
          loading={!!commitId && retroLoading}
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
