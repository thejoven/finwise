import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, CheckCircle2, Clock } from "lucide-react";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBox, Loading, EmptyBox } from "@/components/QueryState";
import { alphax, type CommitmentRow } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/toaster";
import { uuidv4 } from "@/lib/uuid";

function StatusBadge({ s }: { s: string }) {
  const variant =
    s === "signed"
      ? "success"
      : s === "postponed"
      ? "warning"
      : s === "abandoned"
      ? "destructive"
      : "outline";
  return <Badge variant={variant}>{s}</Badge>;
}

export function CommitmentsPage() {
  const { toast } = useToast();
  const [filter, setFilter] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);

  const { data, refetch, isFetching, isLoading, isError, error } = useQuery({
    queryKey: ["commitments", "list"],
    queryFn: alphax.commitments.list,
  });

  const rows = data?.commitments ?? [];
  const filtered = filter
    ? rows.filter((c) =>
        ((c.thesis?.asset_ticker ?? "") + " " + (c.thesis?.asset_name ?? "") + " " + c.status + " " + c.id)
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )
    : rows;

  const selected = rows.find((c) => c.id === openId) ?? null;

  return (
    <div>
      <PageHeader
        title="Commitments"
        description="承诺书 (M7-8). drafted → signed / postponed → abandoned. 点行看正文."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
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
            <div className="shrink-0 text-xs text-muted-foreground">共 {rows.length} 份</div>
          </div>

          {isLoading && <Loading />}
          {isError && (
            <div className="p-4">
              <ErrorBox error={error} />
            </div>
          )}
          {data && filtered.length === 0 && (
            <EmptyBox label={filter ? "没有匹配的承诺" : "还没有承诺书"} />
          )}
          {filtered.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>标的</TableHead>
                  <TableHead>动作</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">仓位</TableHead>
                  <TableHead>签字时间</TableHead>
                  <TableHead>起草时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => setOpenId(c.id)}>
                    <TableCell className="font-medium">
                      {c.thesis?.asset_ticker || "—"}
                      {c.thesis?.asset_name && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          {c.thesis.asset_name}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{c.thesis?.action ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge s={c.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.thesis?.position_pct != null ? `${c.thesis.position_pct}%` : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(c.signed_at, "—")}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(c.drafted_at)}
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
          {selected && <CommitmentDetail c={selected} toast={toast} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CommitmentDetail({
  c,
  toast,
}: {
  c: CommitmentRow;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const qc = useQueryClient();
  const t = c.thesis;
  const [reason, setReason] = React.useState("");

  const sign = useMutation({
    mutationFn: () => alphax.commitments.sign(c.id, uuidv4()),
    onSuccess: () => {
      toast({ title: "已签字", description: "已翻面为持仓.", variant: "success" });
      qc.invalidateQueries({ queryKey: ["commitments"] });
      qc.invalidateQueries({ queryKey: ["holdings"] });
    },
    onError: (err) =>
      toast({ title: "签字失败", description: String(err), variant: "destructive" }),
  });
  const postpone = useMutation({
    mutationFn: () => alphax.commitments.postpone(c.id, uuidv4(), reason || undefined),
    onSuccess: () => {
      toast({ title: "已推迟", variant: "success" });
      qc.invalidateQueries({ queryKey: ["commitments"] });
      qc.invalidateQueries({ queryKey: ["holdings"] });
    },
    onError: (err) =>
      toast({ title: "推迟失败", description: String(err), variant: "destructive" }),
  });

  const canAct = c.status === "drafted" || c.status === "postponed";

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {t?.asset_ticker || "承诺书"} <StatusBadge s={c.status} />
        </DialogTitle>
        <DialogDescription className="font-mono text-[11px]">{c.id}</DialogDescription>
      </DialogHeader>

      {t && (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Field label="标的" value={`${t.asset_ticker}${t.asset_name ? " · " + t.asset_name : ""}`} />
            <Field label="动作" value={t.action} />
            <Field label="仓位" value={`${t.position_pct}%`} />
            <Field label="持有期" value={`${t.duration_months} 个月`} />
          </div>
          {t.entry_method && <Field label="入场方式" value={t.entry_method} />}

          <div>
            <p className="mb-1 text-xs text-muted-foreground">退出条件</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {(t.exit_conditions ?? []).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-1 text-xs text-muted-foreground">给未来自己的理由 (原话)</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {(t.reasons_for_future_self ?? []).map((r) => (
                <li key={r} className="text-muted-foreground">
                  {r}
                </li>
              ))}
            </ul>
          </div>

          <Separator />
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
            <Field label="evaluation_id" value={c.evaluation_id} mono />
            <Field label="推迟次数" value={String(c.postpone_count)} />
            <Field label="起草" value={formatDate(c.drafted_at)} />
            <Field label="签字" value={formatDate(c.signed_at, "—")} />
          </div>
        </div>
      )}

      {canAct && (
        <DialogFooter className="mt-2 flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <Input
              placeholder="推迟原因 (可选)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={postpone.isPending}
              onClick={() => postpone.mutate()}
            >
              <Clock className="mr-1.5 h-4 w-4" /> 推迟
            </Button>
            <Button disabled={sign.isPending} onClick={() => sign.mutate()}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> 签字
            </Button>
          </div>
        </DialogFooter>
      )}
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={mono ? "break-all font-mono text-xs" : "text-sm"}>{value}</p>
    </div>
  );
}
