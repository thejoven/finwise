import * as React from "react";
import { useQuery } from "@tanstack/react-query";
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
import { wiseflow } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useFocusedUser } from "@/lib/focusedUser";

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
  const [status, setStatus] = React.useState<Status>("");
  const [q, setQ] = React.useState("");
  const [submittedQ, setSubmittedQ] = React.useState("");

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["admin", "signals", focused?.id ?? "all", status, submittedQ],
    queryFn: () =>
      wiseflow.admin.signals.list({
        user_id: focused?.id,
        status: status || undefined,
        q: submittedQ || undefined,
        limit: 50,
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
