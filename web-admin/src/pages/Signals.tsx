import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type Status = "" | "pending" | "done" | "failed";
const STATUSES: { v: Status; label: string }[] = [
  { v: "", label: "全部状态" },
  { v: "done", label: "done" },
  { v: "pending", label: "pending" },
  { v: "failed", label: "failed" },
];

function statusVariant(s: string): "success" | "destructive" | "warning" {
  return s === "done" ? "success" : s === "failed" ? "destructive" : "warning";
}

export function SignalsPage() {
  const { focused } = useFocusedUser();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = React.useState<Status>("");
  const [q, setQ] = React.useState("");
  const [submittedQ, setSubmittedQ] = React.useState("");

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["admin", "signals", focused?.id ?? "all", status, submittedQ],
    queryFn: () =>
      alphax.admin.signals.list({
        user_id: focused?.id,
        status: status || undefined,
        q: submittedQ || undefined,
        limit: 50,
      }),
  });

  // 行内按需重推失败信号. 重推不立即改 status (经 outbox 重发, mastra 重跑后才回写); 刷新列表.
  const reinfer = useMutation({
    mutationFn: (id: string) => alphax.admin.signals.reinfer(id),
    onSuccess: (r) => {
      toast({
        title: "已入队重推",
        description: `信号 ${r.signal_id.slice(0, 8)}… · 稍后刷新看结果`,
        variant: "success",
      });
      qc.invalidateQueries({ queryKey: ["admin", "signals"] });
    },
    onError: (err) =>
      toast({
        title: "重推失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });

  const signals = data?.signals ?? [];

  return (
    <div>
      <PageHeader
        title="信号流"
        description={focused ? `聚焦用户 ${focused.email}` : "全用户原始信号 · AI 推断"}
      />
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSubmittedQ(q);
              }}
              className="flex gap-2"
            >
              <Input
                placeholder="搜索原文 / 摘要…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-56"
              />
              <Button type="submit" variant="outline" size="sm">
                搜索
              </Button>
            </form>
            <div className="flex flex-wrap gap-1">
              {STATUSES.map((s) => (
                <Button
                  key={s.v}
                  variant={status === s.v ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatus(s.v)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
            {isFetching && (
              <span className="ml-auto text-xs text-muted-foreground">加载中…</span>
            )}
          </div>

          {isLoading && <Loading />}
          {isError && (
            <div className="p-4">
              <ErrorBox error={error} />
            </div>
          )}
          {data && signals.length === 0 && <EmptyBox label="没有信号" />}
          {signals.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  {!focused && <TableHead>用户</TableHead>}
                  <TableHead>原文 / 摘要</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="whitespace-nowrap">时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.map((s) => (
                  <TableRow key={s.id}>
                    {!focused && (
                      <TableCell className="whitespace-nowrap text-xs">{s.user_email}</TableCell>
                    )}
                    <TableCell className="max-w-md">
                      <p className="truncate">{s.raw_text}</p>
                      {s.inference_summary && (
                        <p className="truncate text-xs text-muted-foreground">
                          {s.inference_summary}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.project_name ? (
                        <Badge variant="outline">{s.project_name}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(s.inference_status)}>
                        {s.inference_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(s.captured_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.inference_status === "failed" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reinfer.mutate(s.id)}
                          disabled={reinfer.isPending && reinfer.variables === s.id}
                        >
                          <RotateCw
                            className={`mr-1 h-3.5 w-3.5 ${
                              reinfer.isPending && reinfer.variables === s.id
                                ? "animate-spin"
                                : ""
                            }`}
                          />
                          重推
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {data?.has_more && (
            <div className="border-t p-2.5 text-center text-xs text-muted-foreground">
              仅显示前 50 条 · 用搜索 / 状态筛选缩小范围
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
