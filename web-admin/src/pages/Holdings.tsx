import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
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
import { wiseflow, type HoldingRow } from "@/lib/api";
import { formatDate } from "@/lib/utils";

function StatusBadge({ s }: { s: string }) {
  const variant =
    s === "active"
      ? "success"
      : s === "triggered"
      ? "warning"
      : s === "closed" || s === "archived" || s === "expired"
      ? "outline"
      : "outline";
  return <Badge variant={variant}>{s}</Badge>;
}

export function HoldingsPage() {
  const [filter, setFilter] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);

  const q = useQuery({
    queryKey: ["holdings", "list"],
    queryFn: wiseflow.holdings.list,
  });

  const rows = q.data?.holdings ?? [];
  const filtered = filter
    ? rows.filter((h) =>
        ((h.ticker ?? "") + " " + h.status + " " + h.id)
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )
    : rows;

  const selected = rows.find((h) => h.id === openId) ?? null;

  return (
    <div>
      <PageHeader
        title="Holdings"
        description="陪伴中持仓 (M9). 由 commitment 签字翻面而来 (holding.id == commitment.id). 点行看详情."
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
              placeholder="按 标的 / 状态 / id 过滤…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-sm"
            />
            <div className="shrink-0 text-xs text-muted-foreground">共 {rows.length} 个</div>
          </div>

          {q.isLoading && <Loading />}
          {q.isError && (
            <div className="p-4">
              <ErrorBox error={q.error} />
            </div>
          )}
          {q.data && filtered.length === 0 && (
            <EmptyBox label={filter ? "没有匹配的持仓" : "还没有持仓"} />
          )}
          {filtered.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>标的</TableHead>
                  <TableHead>动作</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>签字时间</TableHead>
                  <TableHead>到期时间</TableHead>
                  <TableHead>平仓时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((h) => (
                  <TableRow key={h.id} className="cursor-pointer" onClick={() => setOpenId(h.id)}>
                    <TableCell className="font-medium">{h.ticker || "—"}</TableCell>
                    <TableCell className="text-sm">{h.action ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge s={h.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(h.signed_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(h.expires_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(h.closed_at, "—")}
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
          {selected && <HoldingDetail h={selected} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HoldingDetail({ h }: { h: HoldingRow }) {
  // holding.id == commitment.id → 拉对应承诺书拿完整 thesis.
  const commit = useQuery({
    queryKey: ["commitments", "detail", h.id],
    queryFn: () => wiseflow.commitments.get(h.id),
    retry: 0,
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {h.ticker || "持仓"} <StatusBadge s={h.status} />
        </DialogTitle>
        <DialogDescription className="font-mono text-[11px]">{h.id}</DialogDescription>
      </DialogHeader>

      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <Field label="状态" value={h.status} />
          <Field label="动作" value={h.action ?? "—"} />
          <Field label="签字" value={formatDate(h.signed_at)} />
          <Field label="到期" value={formatDate(h.expires_at)} />
          <Field label="触发" value={formatDate(h.triggered_at, "—")} />
          <Field label="平仓" value={formatDate(h.closed_at, "—")} />
        </div>

        <div>
          <p className="mb-1 text-xs text-muted-foreground">退出条件</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {(h.exit_conditions ?? []).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>

        <Separator />
        <p className="text-xs text-muted-foreground">关联承诺书</p>
        {commit.isLoading && <Loading label="加载承诺书…" />}
        {commit.isError && (
          <p className="text-xs text-muted-foreground">无法加载承诺书.</p>
        )}
        {commit.data?.thesis && (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-medium">
              {commit.data.thesis.asset_ticker} · {commit.data.thesis.action} ·{" "}
              {commit.data.thesis.position_pct}% · {commit.data.thesis.duration_months} 个月
            </p>
            {(commit.data.thesis.reasons_for_future_self ?? []).length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {commit.data.thesis.reasons_for_future_self.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
            <Link
              to="/commitments"
              className="mt-2 inline-block text-xs text-primary hover:underline"
            >
              在 Commitments 查看 →
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}
