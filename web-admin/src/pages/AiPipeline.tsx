import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, RotateCw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loading, ErrorBox, EmptyBox } from "@/components/QueryState";
import { alphax } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useFocusedUser } from "@/lib/focusedUser";
import { useToast } from "@/components/ui/toaster";

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "warning" | "danger";
}) {
  const valueColor =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
      ? "text-amber-500"
      : "";
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold leading-none tabular-nums ${valueColor}`}>
        {value}
      </p>
    </div>
  );
}

export function AiPipelinePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { focused } = useFocusedUser();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "inference-health"],
    queryFn: alphax.admin.inference.health,
    refetchInterval: 20_000,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["admin", "inference-health"] });

  // 单条按需重推 (失败行内). 重推不立即改 status — 经 outbox 重发, mastra 重跑后才回写 done.
  const reinferOne = useMutation({
    mutationFn: (id: string) => alphax.admin.signals.reinfer(id),
    onSuccess: (r) => {
      toast({
        title: "已入队重推",
        description: `信号 ${r.signal_id.slice(0, 8)}… · 稍后刷新看结果`,
        variant: "success",
      });
      invalidate();
    },
    onError: (err) =>
      toast({
        title: "重推失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });

  // 批量重推全部 failed; 有聚焦用户时只重推该用户的 (尊重"聚焦").
  const reinferAll = useMutation({
    mutationFn: () =>
      alphax.admin.signals.reinferFailed({ user_id: focused?.id }),
    onSuccess: (r) => {
      toast({
        title:
          r.reinfered > 0
            ? `已入队重推 ${r.reinfered} 条失败信号`
            : "没有失败信号可重推",
        description: focused ? `聚焦用户 ${focused.email}` : "全部用户",
        variant: "success",
      });
      invalidate();
    },
    onError: (err) =>
      toast({
        title: "批量重推失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });

  return (
    <div>
      <PageHeader
        title="AI 流水线"
        description="信号推断的运行健康 · 全用户。失败/卡住的推断可按需重推。"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => reinferAll.mutate()}
              disabled={reinferAll.isPending || !data || data.failed === 0}
            >
              <RotateCw
                className={`h-3.5 w-3.5 ${reinferAll.isPending ? "animate-spin" : ""}`}
              />
              批量重推失败{focused ? "（本用户）" : ""}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              刷新
            </Button>
          </div>
        }
      />

      {isLoading && <Loading />}
      {isError && <ErrorBox error={error} />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="待处理" value={data.pending} tone={data.pending > 0 ? "warning" : undefined} />
            <Stat label="失败" value={data.failed} tone={data.failed > 0 ? "danger" : undefined} />
            <Stat label="已完成" value={data.done} />
            <Stat label="平均时延" value={`${data.avg_latency_seconds}s`} />
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base">最近失败推断</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data.recent_failures.length === 0 ? (
                <EmptyBox label="没有失败的推断" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户</TableHead>
                      <TableHead>原文</TableHead>
                      <TableHead className="whitespace-nowrap">捕获时间</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recent_failures.map((f) => {
                      const pending =
                        reinferOne.isPending && reinferOne.variables === f.signal_id;
                      return (
                        <TableRow key={f.signal_id}>
                          <TableCell className="whitespace-nowrap font-medium">{f.email || "—"}</TableCell>
                          <TableCell className="max-w-md truncate text-muted-foreground">{f.text_preview}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatDate(f.captured_at)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => reinferOne.mutate(f.signal_id)}
                              disabled={pending}
                            >
                              <RotateCw className={`mr-1 h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
                              重推
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
