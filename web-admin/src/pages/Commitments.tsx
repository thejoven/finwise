import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, CheckCircle2, Clock } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import { ErrorBox, Loading, EmptyBox } from "@/components/QueryState";
import { flashfi, type CommitmentRow } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/toaster";

export function CommitmentsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const q = useQuery({
    queryKey: ["commitments-active"],
    queryFn: flashfi.commitments.active,
  });

  const sign = useMutation({
    mutationFn: (id: string) => flashfi.commitments.sign(id),
    onSuccess: () => {
      toast({ title: "已签字", variant: "success" });
      qc.invalidateQueries({ queryKey: ["commitments-active"] });
    },
    onError: (err) =>
      toast({
        title: "签字失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });

  const [postponeFor, setPostponeFor] = React.useState<CommitmentRow | null>(null);
  const [postponeDate, setPostponeDate] = React.useState("");

  const postpone = useMutation({
    mutationFn: ({ id, until }: { id: string; until: string }) =>
      flashfi.commitments.postpone(id, until),
    onSuccess: () => {
      toast({ title: "已推迟", variant: "success" });
      setPostponeFor(null);
      qc.invalidateQueries({ queryKey: ["commitments-active"] });
    },
    onError: (err) =>
      toast({
        title: "推迟失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });

  const rows: CommitmentRow[] = q.data ? [q.data] : [];

  return (
    <div>
      <PageHeader
        title="Commitments"
        description="承诺书 (M7-8). 状态流转: drafted → signed / postponed → closed."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />
            刷新
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {q.isLoading && <Loading />}
          {q.isError && (
            <div className="p-4">
              <ErrorBox error={q.error} />
            </div>
          )}
          {q.data && rows.length === 0 && <EmptyBox label="当前没有活跃承诺" />}
          {q.data && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Signed at</TableHead>
                  <TableHead>Postponed until</TableHead>
                  <TableHead className="text-right">动作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">
                      {c.id.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="font-medium">
                      {c.ticker ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          c.status === "signed"
                            ? "success"
                            : c.status === "postponed"
                            ? "warning"
                            : "outline"
                        }
                      >
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(c.signed_at, "—")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(c.postponed_until, "—")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => sign.mutate(c.id)}
                          disabled={sign.isPending}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> 签字
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPostponeFor(c);
                            setPostponeDate(
                              new Date(Date.now() + 86400_000 * 7)
                                .toISOString()
                                .slice(0, 10),
                            );
                          }}
                        >
                          <Clock className="h-3.5 w-3.5" /> 推迟
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!postponeFor} onOpenChange={(o) => !o && setPostponeFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>推迟承诺</DialogTitle>
            <DialogDescription>
              {postponeFor?.ticker} — {postponeFor?.id}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="until">推迟到</Label>
            <Input
              id="until"
              type="date"
              value={postponeDate}
              onChange={(e) => setPostponeDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostponeFor(null)}>
              取消
            </Button>
            <Button
              disabled={postpone.isPending || !postponeDate}
              onClick={() => {
                if (!postponeFor) return;
                const iso = new Date(postponeDate).toISOString();
                postpone.mutate({ id: postponeFor.id, until: iso });
              }}
            >
              {postpone.isPending ? "提交中…" : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
