import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ErrorBox, Loading } from "@/components/QueryState";
import { flashfi } from "@/lib/api";
import { formatDate } from "@/lib/utils";

export function SignalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ["signal", id],
    queryFn: () => flashfi.signals.get(id!),
    enabled: !!id,
  });
  const refine = useQuery({
    queryKey: ["refinement-by-signal", id],
    queryFn: () => flashfi.refinement.bySignal(id!),
    enabled: !!id,
    retry: 0,
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
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">model</span>
                <span className="font-mono text-xs">
                  {q.data.inference_model ?? "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">done_at</span>
                <span className="text-xs">
                  {formatDate(q.data.inference_done_at, "—")}
                </span>
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

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Refinement session</CardTitle>
              <CardDescription>该信号关联的 M5 五轮追问会话.</CardDescription>
            </CardHeader>
            <CardContent>
              {refine.isLoading && <Loading label="查询会话…" />}
              {refine.isError && (
                <p className="text-xs text-muted-foreground">
                  无关联会话 (或后端未启用 M5).
                </p>
              )}
              {refine.data && (
                <div className="grid gap-3 sm:grid-cols-3 text-sm">
                  <Field label="session_id" value={String(refine.data.id)} mono />
                  <Field label="status" value={String(refine.data.status)} />
                  <Field label="updated" value={formatDate(refine.data.updated_at)} />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
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
