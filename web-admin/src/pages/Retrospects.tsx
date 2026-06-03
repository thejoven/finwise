import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
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
import { wiseflow, type RetrospectRow } from "@/lib/api";
import { formatDate } from "@/lib/utils";

function StateBadge({ s }: { s: string }) {
  const variant =
    s === "finalized" ? "success" : s === "answered" ? "warning" : "outline";
  return <Badge variant={variant}>{s}</Badge>;
}

export function RetrospectsPage() {
  const [filter, setFilter] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);

  const q = useQuery({
    queryKey: ["retrospects"],
    queryFn: wiseflow.retrospects.list,
  });

  const rows = q.data?.retrospects ?? [];
  const filtered = filter
    ? rows.filter((r) =>
        (r.id + " " + r.commitment_id + " " + r.state + " " + (r.focus_dim ?? ""))
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )
    : rows;

  const selected = rows.find((r) => r.id === openId) ?? null;

  return (
    <div>
      <PageHeader
        title="Retrospects"
        description="复盘训练 (M11). pending → answered → finalized. 点行看答题与训练重点."
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
              placeholder="按 id / commitment / 状态 过滤…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-sm"
            />
            <div className="shrink-0 text-xs text-muted-foreground">共 {rows.length} 次复盘</div>
          </div>

          {q.isLoading && <Loading />}
          {q.isError && (
            <div className="p-4">
              <ErrorBox error={q.error} />
            </div>
          )}
          {q.data && filtered.length === 0 && (
            <EmptyBox label={filter ? "没有匹配的复盘" : "还没有复盘记录"} />
          )}
          {filtered.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-center">答题数</TableHead>
                  <TableHead>训练重点</TableHead>
                  <TableHead>开始时间</TableHead>
                  <TableHead>完成时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                    <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}…</TableCell>
                    <TableCell>
                      <StateBadge s={r.state} />
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {(r.answers ?? []).length}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <span className="line-clamp-1 text-sm">{r.focus_dim || "—"}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(r.started_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(r.finalized_at, "—")}
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
          {selected && <RetrospectDetail r={selected} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RetrospectDetail({ r }: { r: RetrospectRow }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          复盘 <StateBadge s={r.state} />
        </DialogTitle>
        <DialogDescription className="font-mono text-[11px]">{r.id}</DialogDescription>
      </DialogHeader>

      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div>
            <span>commitment_id</span>
            <p className="break-all font-mono">{r.commitment_id}</p>
          </div>
          <div>
            <span>诊断模型</span>
            <p>{r.diagnostician_model || "—"}</p>
          </div>
          <div>
            <span>开始</span>
            <p>{formatDate(r.started_at)}</p>
          </div>
          <div>
            <span>完成</span>
            <p>{formatDate(r.finalized_at, "—")}</p>
          </div>
        </div>

        {(r.focus_dim || r.focus_text) && (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">训练重点</p>
            {r.focus_dim && <p className="mt-0.5 font-medium">{r.focus_dim}</p>}
            {r.focus_text && <p className="mt-1 text-sm">{r.focus_text}</p>}
          </div>
        )}

        <Separator />
        <p className="text-xs text-muted-foreground">答题记录</p>
        {(r.answers ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">还没有作答.</p>
        )}
        <div className="space-y-2">
          {(r.answers ?? []).map((a) => (
            <div key={a.q} className="rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">第 {a.q} 题</Badge>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {a.dim}
                </span>
              </div>
              <p className="mt-1 text-sm">选择: {a.choice}</p>
              {a.open_text && (
                <p className="mt-1 rounded bg-muted/40 p-2 text-sm">{a.open_text}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
