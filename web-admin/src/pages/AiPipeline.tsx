import * as React from "react";
import { useQuery } from "@tanstack/react-query";
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
import { wiseflow } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

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
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "inference-health"],
    queryFn: wiseflow.admin.inference.health,
    refetchInterval: 20_000,
  });

  return (
    <div>
      <PageHeader
        title="AI 流水线"
        description="信号推断的运行健康 · 全用户。"
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            刷新
          </Button>
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recent_failures.map((f) => (
                      <TableRow key={f.signal_id}>
                        <TableCell className="whitespace-nowrap font-medium">{f.email || "—"}</TableCell>
                        <TableCell className="max-w-md truncate text-muted-foreground">{f.text_preview}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDate(f.captured_at)}
                        </TableCell>
                      </TableRow>
                    ))}
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
