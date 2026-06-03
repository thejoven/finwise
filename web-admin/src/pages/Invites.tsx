import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Plus, RefreshCw, Ticket, XCircle } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBox, Loading, EmptyBox } from "@/components/QueryState";
import {
  wiseflow,
  type CreateInviteInput,
  type InviteCodeRow,
  type InviteStatus,
} from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/toaster";

const STATUS_BADGE: Record<
  InviteStatus,
  { label: string; variant: "success" | "secondary" | "outline" | "destructive" }
> = {
  active: { label: "可用", variant: "success" },
  exhausted: { label: "已用尽", variant: "secondary" },
  expired: { label: "已过期", variant: "outline" },
  revoked: { label: "已吊销", variant: "destructive" },
};

// 复制按钮: 点一下把文本写进剪贴板, 短暂显示 ✓ 反馈.
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-600" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

export function InvitesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = React.useState(false);
  // 新建表单
  const [label, setLabel] = React.useState("");
  const [maxUses, setMaxUses] = React.useState("1"); // 留空 = 不限次
  const [expiresDays, setExpiresDays] = React.useState(""); // 留空 = 永不过期
  // 刚生成的码 (创建成功后在 dialog 里高亮显示, 方便复制发给受邀人)
  const [created, setCreated] = React.useState<InviteCodeRow | null>(null);

  const q = useQuery({
    queryKey: ["admin", "invites"],
    queryFn: wiseflow.admin.invites.list,
  });

  function resetForm() {
    setLabel("");
    setMaxUses("1");
    setExpiresDays("");
    setCreated(null);
  }

  const createMut = useMutation({
    mutationFn: (input: CreateInviteInput) => wiseflow.admin.invites.create(input),
    onSuccess: (row: InviteCodeRow) => {
      setCreated(row);
      qc.invalidateQueries({ queryKey: ["admin", "invites"] });
    },
    onError: (err) => {
      toast({
        title: "创建失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => wiseflow.admin.invites.revoke(id),
    onSuccess: (row: InviteCodeRow) => {
      toast({ title: "已吊销邀请码", description: row.code, variant: "success" });
      qc.invalidateQueries({ queryKey: ["admin", "invites"] });
    },
    onError: (err) => {
      toast({
        title: "吊销失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  function handleCreate() {
    const trimmedLabel = label.trim();
    const input: CreateInviteInput = {
      label: trimmedLabel.length > 0 ? trimmedLabel : null,
      max_uses: maxUses.trim() === "" ? null : Number(maxUses),
      expires_in_days: expiresDays.trim() === "" ? null : Number(expiresDays),
    };
    createMut.mutate(input);
  }

  const rows = q.data?.invites ?? [];
  const activeCount = rows.filter((r) => r.status === "active").length;

  const maxUsesInvalid =
    maxUses.trim() !== "" && (!Number.isInteger(Number(maxUses)) || Number(maxUses) < 1);
  const expiresInvalid =
    expiresDays.trim() !== "" &&
    (!Number.isInteger(Number(expiresDays)) || Number(expiresDays) < 1);

  return (
    <div>
      <PageHeader
        title="邀请码 Invites"
        description="注册需要邀请码. 在此生成邀请码发给受邀人, 并可随时吊销."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => q.refetch()}
              disabled={q.isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />
              刷新
            </Button>
            <Button
              size="sm"
              onClick={() => {
                resetForm();
                setCreateOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              新建邀请码
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 border-b p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Ticket className="h-4 w-4" />
              邀请码
            </div>
            <div className="shrink-0 text-xs text-muted-foreground">
              共 {rows.length} 个 · {activeCount} 个可用
            </div>
          </div>

          {q.isLoading && <Loading />}
          {q.isError && (
            <div className="p-4">
              <ErrorBox error={q.error} />
            </div>
          )}
          {q.data && rows.length === 0 && <EmptyBox label="还没有邀请码 — 点右上角新建一个" />}
          {q.data && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>邀请码</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">已用 / 上限</TableHead>
                  <TableHead>有效期至</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const badge = STATUS_BADGE[r.status];
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-sm tracking-wide">{r.code}</span>
                          <CopyButton value={r.code} />
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.label || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.uses} / {r.max_uses ?? "∞"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {r.expires_at ? formatDate(r.expires_at) : "永不过期"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(r.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.status === "active" || r.status === "exhausted" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            disabled={revokeMut.isPending}
                            onClick={() => revokeMut.mutate(r.id)}
                          >
                            <XCircle className="mr-1 h-3.5 w-3.5" />
                            吊销
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) resetForm();
        }}
      >
        <DialogContent>
          {created ? (
            // ── 创建成功: 高亮展示新码 + 复制 ──
            <>
              <DialogHeader>
                <DialogTitle>邀请码已生成</DialogTitle>
                <DialogDescription>
                  复制并发给受邀人. 关闭后仍可在列表里查看/复制.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 p-4">
                <span className="font-mono text-xl font-semibold tracking-widest">
                  {created.code}
                </span>
                <CopyButton value={created.code} />
              </div>
              <p className="text-xs text-muted-foreground">
                上限 {created.max_uses ?? "不限"} 次 ·{" "}
                {created.expires_at
                  ? `有效期至 ${formatDate(created.expires_at)}`
                  : "永不过期"}
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={resetForm}>
                  再建一个
                </Button>
                <Button onClick={() => setCreateOpen(false)}>完成</Button>
              </DialogFooter>
            </>
          ) : (
            // ── 创建表单 ──
            <>
              <DialogHeader>
                <DialogTitle>新建邀请码</DialogTitle>
                <DialogDescription>
                  上限留空 = 不限次数; 有效天数留空 = 永不过期.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="invite-label">备注（可选）</Label>
                  <Input
                    id="invite-label"
                    placeholder="例如: 给老王 / 内测一批"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    maxLength={80}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-max">最大使用次数</Label>
                    <Input
                      id="invite-max"
                      type="number"
                      min={1}
                      placeholder="留空 = 不限"
                      value={maxUses}
                      onChange={(e) => setMaxUses(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-expires">有效天数</Label>
                    <Input
                      id="invite-expires"
                      type="number"
                      min={1}
                      placeholder="留空 = 永久"
                      value={expiresDays}
                      onChange={(e) => setExpiresDays(e.target.value)}
                    />
                  </div>
                </div>
                {(maxUsesInvalid || expiresInvalid) && (
                  <p className="text-xs text-destructive">
                    使用次数和有效天数需为正整数（或留空）。
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                  取消
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={createMut.isPending || maxUsesInvalid || expiresInvalid}
                >
                  {createMut.isPending ? "生成中…" : "生成邀请码"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
