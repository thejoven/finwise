import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBox, Loading, EmptyBox } from "@/components/QueryState";
import { wiseflow, type AdminUserRow, type User } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/toaster";

export function UsersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = React.useState("");
  const [selected, setSelected] = React.useState<AdminUserRow | null>(null);

  const me = useQuery({ queryKey: ["me"], queryFn: wiseflow.me });
  const q = useQuery({
    queryKey: ["admin", "users"],
    queryFn: wiseflow.admin.users.list,
  });

  const setAdmin = useMutation({
    mutationFn: ({ id, is_admin }: { id: string; is_admin: boolean }) =>
      wiseflow.admin.users.setAdmin(id, is_admin),
    onSuccess: (u: User) => {
      toast({
        title: u.is_admin ? "已设为管理员" : "已取消管理员",
        description: u.email,
        variant: "success",
      });
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err) => {
      toast({
        title: "操作失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const rows = q.data?.users ?? [];
  const filtered = filter
    ? rows.filter((r) =>
        (r.email + " " + (r.display_name ?? "") + " " + r.id)
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )
    : rows;

  const adminCount = rows.filter((r) => r.is_admin).length;

  return (
    <div>
      <PageHeader
        title="用户 Users"
        description="后台接入的全部注册用户. 管理员可在此查看活动并授予/收回管理员权限."
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
          <div className="flex items-center justify-between gap-3 border-b p-3">
            <Input
              placeholder="按 邮箱 / 名称 / id 搜索…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-sm"
            />
            <div className="shrink-0 text-xs text-muted-foreground">
              共 {rows.length} 人 · {adminCount} 名管理员
            </div>
          </div>

          {q.isLoading && <Loading />}
          {q.isError && (
            <div className="p-4">
              <ErrorBox error={q.error} />
            </div>
          )}
          {q.data && filtered.length === 0 && <EmptyBox label="没有用户" />}
          {q.data && filtered.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>邮箱</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead className="text-right">信号数</TableHead>
                  <TableHead>最近活跃</TableHead>
                  <TableHead>注册时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => (
                  <TableRow
                    key={u.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(u)}
                  >
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.display_name || "—"}
                    </TableCell>
                    <TableCell>
                      {u.is_admin ? (
                        <Badge variant="success">管理员</Badge>
                      ) : (
                        <Badge variant="outline">用户</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {u.signal_count}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(u.last_seen_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(u.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.email}</DialogTitle>
                <DialogDescription>
                  {selected.display_name || "未设置名称"} ·{" "}
                  <span className="font-mono text-[11px]">{selected.id}</span>
                </DialogDescription>
              </DialogHeader>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">角色</dt>
                  <dd>{selected.is_admin ? "管理员" : "普通用户"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">信号数</dt>
                  <dd className="tabular-nums">{selected.signal_count}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">最近活跃</dt>
                  <dd>{formatDate(selected.last_seen_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">注册时间</dt>
                  <dd>{formatDate(selected.created_at)}</dd>
                </div>
                {selected.bio && (
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">简介</dt>
                    <dd className="whitespace-pre-wrap">{selected.bio}</dd>
                  </div>
                )}
              </dl>

              <DialogFooter className="sm:justify-between">
                {me.data?.id === selected.id ? (
                  <p className="text-xs text-muted-foreground">这是你自己的账号.</p>
                ) : selected.is_admin ? (
                  <Button
                    variant="outline"
                    disabled={setAdmin.isPending}
                    onClick={() =>
                      setAdmin.mutate({ id: selected.id, is_admin: false })
                    }
                  >
                    <ShieldOff className="mr-1.5 h-4 w-4" />
                    取消管理员
                  </Button>
                ) : (
                  <Button
                    disabled={setAdmin.isPending}
                    onClick={() =>
                      setAdmin.mutate({ id: selected.id, is_admin: true })
                    }
                  >
                    <ShieldCheck className="mr-1.5 h-4 w-4" />
                    设为管理员
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setSelected(null)}>
                  关闭
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
