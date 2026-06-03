import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBox, Loading, EmptyBox } from "@/components/QueryState";
import { wiseflow } from "@/lib/api";
import { formatDate, truncate } from "@/lib/utils";
import { useToast } from "@/components/ui/toaster";
import { uuidv4 } from "@/lib/uuid";

function StatusBadge({ s }: { s: string }) {
  const variant =
    s === "completed" ? "success" : s === "active" ? "warning" : "outline";
  return <Badge variant={variant}>{s}</Badge>;
}

function DecisionBadge({ d }: { d?: string | null }) {
  if (!d) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Badge variant={d === "eligible_for_gate" ? "success" : "outline"}>{d}</Badge>
  );
}

export function RefinementsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = React.useState("");
  const [newSignalId, setNewSignalId] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);

  const list = useQuery({
    queryKey: ["refinement", "list"],
    queryFn: wiseflow.refinement.list,
  });

  const start = useMutation({
    mutationFn: (sid: string) => wiseflow.refinement.start(sid, uuidv4()),
    onSuccess: (s) => {
      toast({ title: "已开启会话", description: s.id, variant: "success" });
      setNewSignalId("");
      qc.invalidateQueries({ queryKey: ["refinement", "list"] });
      setOpenId(s.id);
    },
    onError: (err) =>
      toast({
        title: "开启失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });

  const sessions = list.data?.sessions ?? [];
  const filtered = filter
    ? sessions.filter((s) =>
        (
          (s.primary_signal_raw_text ?? "") +
          " " +
          (s.primary_signal_summary ?? "") +
          " " +
          s.status +
          " " +
          s.id +
          " " +
          s.primary_signal_id
        )
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )
    : sessions;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Refinement"
        description="M5 五轮追问会话. 底部列出全部对话, 点开看逐轮问答."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => list.refetch()}
            disabled={list.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${list.isFetching ? "animate-spin" : ""}`} />
            刷新
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>新开会话</CardTitle>
          <CardDescription>填 signal_id 对某条信号开启五轮追问 (会话已存在则复用).</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newSignalId.trim()) start.mutate(newSignalId.trim());
            }}
            className="flex gap-2"
          >
            <Input
              value={newSignalId}
              onChange={(e) => setNewSignalId(e.target.value)}
              placeholder="primary_signal_id (UUID)"
              className="max-w-md"
            />
            <Button type="submit" disabled={!newSignalId.trim() || start.isPending}>
              {start.isPending ? "开启中…" : "新开会话"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 border-b p-3">
            <Input
              placeholder="按 信号文本 / 状态 / id 过滤…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-sm"
            />
            <div className="shrink-0 text-xs text-muted-foreground">
              共 {sessions.length} 个对话
            </div>
          </div>

          {list.isLoading && <Loading />}
          {list.isError && (
            <div className="p-4">
              <ErrorBox error={list.error} />
            </div>
          )}
          {list.data && filtered.length === 0 && (
            <EmptyBox label={filter ? "没有匹配的对话" : "还没有追问会话"} />
          )}
          {filtered.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>信号</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-center">轮次</TableHead>
                  <TableHead>决策</TableHead>
                  <TableHead>开始时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => setOpenId(s.id)}
                  >
                    <TableCell className="max-w-md">
                      <div className="line-clamp-1 font-medium">
                        {s.primary_signal_summary ||
                          truncate(s.primary_signal_raw_text, 80) ||
                          s.primary_signal_id.slice(0, 8) + "…"}
                      </div>
                      {s.primary_asset && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          标的: {s.primary_asset}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge s={s.status} />
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {s.rounds_done}/5
                    </TableCell>
                    <TableCell>
                      <DecisionBadge d={s.decision} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(s.started_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {openId && <RefinementDetail sessionId={openId} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// RefinementDetail 拉单个会话的完整问答, 逐轮渲染成"对话".
function RefinementDetail({ sessionId }: { sessionId: string }) {
  const q = useQuery({
    queryKey: ["refinement", "detail", sessionId],
    queryFn: () => wiseflow.refinement.get(sessionId),
    retry: 0,
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>追问对话</DialogTitle>
        <DialogDescription className="font-mono text-[11px]">
          session {sessionId}
        </DialogDescription>
      </DialogHeader>

      {q.isLoading && <Loading label="加载对话…" />}
      {q.isError && <ErrorBox error={q.error} />}
      {q.data && (
        <div className="space-y-4">
          {/* 会话头 */}
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="whitespace-pre-wrap">{q.data.primary_signal_raw_text || "—"}</p>
            {q.data.primary_signal_summary && (
              <p className="mt-1 text-xs text-muted-foreground">
                {q.data.primary_signal_summary}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge s={q.data.status} />
              <span className="text-muted-foreground">{q.data.rounds_done}/5 轮</span>
              <DecisionBadge d={q.data.decision} />
              {q.data.project_name && (
                <Badge variant="outline">分类: {q.data.project_name}</Badge>
              )}
            </div>
          </div>

          {/* 逐轮问答 */}
          {q.data.rounds.length === 0 && (
            <p className="text-sm text-muted-foreground">还没有已回答的轮次.</p>
          )}
          {q.data.rounds.map((r) => {
            const chosen = new Set(r.user_answer.choice_ids ?? []);
            return (
              <div key={r.round} className="rounded-md border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant="outline">第 {r.round} 轮</Badge>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {r.question_kind}
                  </span>
                </div>

                {/* 问题 */}
                <p className="text-sm font-medium">🤖 {r.question_text}</p>

                {/* 选项 + 用户选择 */}
                {r.options && r.options.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {r.options.map((o) => (
                      <div
                        key={o.id}
                        className={
                          "flex items-start gap-2 rounded px-2 py-1 text-sm " +
                          (chosen.has(o.id)
                            ? "bg-primary/10 font-medium"
                            : "text-muted-foreground")
                        }
                      >
                        <span>{chosen.has(o.id) ? "🧑 ●" : "○"}</span>
                        <span className="flex-1">{o.text}</span>
                        {o.is_distractor && (
                          <Badge variant="outline" className="text-[10px]">
                            干扰项
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* 开放文本回答 */}
                {r.user_answer.open_text && (
                  <p className="mt-2 rounded bg-muted/40 p-2 text-sm">
                    🧑 {r.user_answer.open_text}
                  </p>
                )}

                {/* 诊断 */}
                <Separator className="my-2" />
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">🔎 诊断</span>
                  <Badge variant="outline">{r.diagnosis.kind}</Badge>
                  {r.diagnosis.note && (
                    <span className="text-muted-foreground">{r.diagnosis.note}</span>
                  )}
                  {typeof r.user_answer.time_ms === "number" &&
                    r.user_answer.time_ms > 0 && (
                      <span className="ml-auto text-muted-foreground">
                        用时 {(r.user_answer.time_ms / 1000).toFixed(1)}s
                      </span>
                    )}
                </div>
              </div>
            );
          })}

          {/* 待答题目 */}
          {q.data.pending_question && (
            <p className="text-xs text-muted-foreground">
              ⏳ 第 {q.data.pending_question.round} 轮题目已生成, 等待用户作答.
            </p>
          )}
        </div>
      )}
    </>
  );
}
