import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Check, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
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
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBox, Loading, EmptyBox } from "@/components/QueryState";
import { wiseflow, type GateEvaluation } from "@/lib/api";
import { formatDate } from "@/lib/utils";

function PassPill({ pass }: { pass: boolean }) {
  return pass ? (
    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
      <Check className="h-3.5 w-3.5" /> 通过
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-destructive">
      <X className="h-3.5 w-3.5" /> 未过
    </span>
  );
}

export function GatePage() {
  const [filter, setFilter] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);

  const q = useQuery({
    queryKey: ["gate", "list"],
    queryFn: wiseflow.gate.listAll,
    retry: 0,
  });

  const rows = q.data?.evaluations ?? [];
  const filtered = filter
    ? rows.filter((e) =>
        (e.id + " " + e.refinement_id + " " + (e.archived_pool ?? "") + (e.passed ? " passed" : " failed"))
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )
    : rows;

  const selected = rows.find((e) => e.id === openId) ?? null;

  return (
    <div>
      <PageHeader
        title="分析师评审"
        description="M6 投决会 · 四位分析师 (佐证 · 共识 · 时机 · 能力圈). 全部评估, 点行看明细."
        actions={
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />
            刷新
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 border-b p-3">
            <Input
              placeholder="按 id / refinement / 池 / passed 过滤…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-sm"
            />
            <div className="shrink-0 text-xs text-muted-foreground">共 {rows.length} 次评估</div>
          </div>

          {q.isLoading && <Loading />}
          {q.isError && (
            <div className="p-4">
              <ErrorBox error={q.error} />
            </div>
          )}
          {q.data && filtered.length === 0 && (
            <EmptyBox label={filter ? "没有匹配的评估" : "还没有评估"} />
          )}
          {filtered.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>评估 ID</TableHead>
                  <TableHead>结果</TableHead>
                  <TableHead>失败门</TableHead>
                  <TableHead>归档池</TableHead>
                  <TableHead>评估时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => (
                  <TableRow key={e.id} className="cursor-pointer" onClick={() => setOpenId(e.id)}>
                    <TableCell className="font-mono text-xs">{e.id.slice(0, 8)}…</TableCell>
                    <TableCell>
                      {e.passed ? (
                        <Badge variant="success">通过</Badge>
                      ) : (
                        <Badge variant="destructive">未过</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {e.failed_gate ? `第 ${e.failed_gate} 门` : "—"}
                    </TableCell>
                    <TableCell>
                      {e.archived_pool ? (
                        <Badge variant="outline">{e.archived_pool}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(e.evaluated_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selected && <GateDetail e={selected} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GateRow({
  title,
  pass,
  meta,
  detail,
  children,
}: {
  title: string;
  pass: boolean;
  meta?: string;
  detail?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{title}</span>
        <PassPill pass={pass} />
      </div>
      {meta && <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>}
      {detail && <p className="mt-1 text-sm">{detail}</p>}
      {children}
    </div>
  );
}

function GateDetail({ e }: { e: GateEvaluation }) {
  const g = e.gates;
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          评估明细
          {e.passed ? <Badge variant="success">通过</Badge> : <Badge variant="destructive">未过</Badge>}
        </DialogTitle>
        <DialogDescription className="font-mono text-[11px]">{e.id}</DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div>
            <span className="text-muted-foreground">refinement_id</span>
            <p className="break-all font-mono">{e.refinement_id}</p>
          </div>
          <div>
            <span className="text-muted-foreground">评估时间</span>
            <p>{formatDate(e.evaluated_at)}</p>
          </div>
        </div>

        <Separator />

        {g ? (
          <>
            <GateRow
              title="① 佐证 · 信号厚度"
              pass={g.g1_thickness.pass}
              meta={`独立信号 ${g.g1_thickness.count} 条`}
              detail={g.g1_thickness.detail}
            />
            <GateRow
              title="② 共识 · 反共识"
              pass={g.g2_anti_consensus.pass}
              meta={`反共识得分 ${g.g2_anti_consensus.score}/100`}
              detail={g.g2_anti_consensus.detail}
            >
              {(g.g2_anti_consensus.unpriced_directions ?? []).length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-muted-foreground">未被定价的方向</p>
                  {g.g2_anti_consensus.unpriced_directions!.map((u) => (
                    <div key={u.angle} className="rounded bg-muted/40 p-2 text-xs">
                      <span className="font-medium">{u.angle}</span> — {u.why_unpriced}
                    </div>
                  ))}
                </div>
              )}
            </GateRow>
            <GateRow
              title="③ 时机 · 窗口"
              pass={g.g3_window.pass}
              meta={`窗口 ${g.g3_window.months} 个月`}
              detail={g.g3_window.detail}
            />
            <GateRow
              title="④ 能力圈 · 边缘"
              pass={g.g4_edge.pass}
              detail={g.g4_edge.detail}
            >
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {[
                  ["能解释", g.g4_edge.sub.explain],
                  ["直接", g.g4_edge.sub.direct],
                  ["有记录", g.g4_edge.sub.track_record],
                  ["知道何时退出", g.g4_edge.sub.exit_known],
                ].map(([label, ok]) => (
                  <span
                    key={label as string}
                    className={
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 " +
                      (ok ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground")
                    }
                  >
                    {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    {label as string}
                  </span>
                ))}
              </div>
            </GateRow>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">无评估明细.</p>
        )}
      </div>
    </>
  );
}
