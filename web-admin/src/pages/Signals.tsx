import * as React from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, RefreshCw } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ErrorBox, Loading, EmptyBox } from "@/components/QueryState";
import { wiseflow } from "@/lib/api";
import { formatDate, truncate } from "@/lib/utils";
import { useToast } from "@/components/ui/toaster";
import { uuidv4 } from "@/lib/uuid";

const PAGE_SIZE = 20;

// useDebounced 把高频输入降频, 避免每个按键都打一次服务端搜索.
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function StatusBadge({ s }: { s: string }) {
  const variant =
    s === "done" ? "success" : s === "failed" ? "destructive" : "warning";
  return <Badge variant={variant}>{s}</Badge>;
}

export function SignalsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = React.useState("");
  const debouncedSearch = useDebounced(search.trim(), 300);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  // 游标分页: pageParam = 上一页最后一条的 captured_at (后端 captured_at < before).
  const q = useInfiniteQuery({
    queryKey: ["signals", "list", debouncedSearch],
    queryFn: ({ pageParam }) =>
      wiseflow.signals.list({
        q: debouncedSearch || undefined,
        limit: PAGE_SIZE,
        before: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      const last = lastPage.signals[lastPage.signals.length - 1];
      return last?.captured_at;
    },
  });

  const capture = useMutation({
    mutationFn: (raw: string) => wiseflow.signals.capture(raw, uuidv4()),
    onSuccess: () => {
      toast({
        title: "信号已捕获",
        description: "事件已落 events 表, 由 outbox 推 NATS.",
        variant: "success",
      });
      setDraft("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["signals"] });
    },
    onError: (err) => {
      toast({
        title: "捕获失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const rows = q.data?.pages.flatMap((p) => p.signals) ?? [];

  return (
    <div>
      <PageHeader
        title="Signals"
        description="原始信号事件流. 走 POST /v1/signals 入, 经 outbox 投到 NATS, Mastra 推回 inference."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => q.refetch()}
              disabled={q.isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />
              刷新
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-3.5 w-3.5" /> 新建信号
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>捕获新信号</DialogTitle>
                  <DialogDescription>
                    把模糊的高价值信号写成一段自然语言.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="raw">raw_text</Label>
                  <Textarea
                    id="raw"
                    rows={5}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="例如: 今天供应商说 HBM 又涨价了."
                  />
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setOpen(false)}
                    disabled={capture.isPending}
                  >
                    取消
                  </Button>
                  <Button
                    onClick={() => draft.trim() && capture.mutate(draft.trim())}
                    disabled={!draft.trim() || capture.isPending}
                  >
                    {capture.isPending ? "提交中…" : "提交"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 border-b p-3">
            <div className="relative max-w-sm flex-1">
              <Input
                placeholder="服务端搜索 raw_text / summary…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {q.isFetching && !q.isFetchingNextPage && (
                <RefreshCw className="absolute right-2.5 top-2.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
            <div className="shrink-0 text-xs text-muted-foreground">
              已加载 {rows.length} 条{q.hasNextPage ? " · 还有更多" : ""}
            </div>
          </div>

          {q.isLoading && <Loading />}
          {q.isError && (
            <div className="p-4">
              <ErrorBox error={q.error} />
            </div>
          )}
          {!q.isLoading && !q.isError && rows.length === 0 && (
            <EmptyBox label={debouncedSearch ? "没有匹配的信号" : "还没有信号"} />
          )}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Raw text</TableHead>
                  <TableHead>Inference</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Captured</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        to={`/signals/${s.id}`}
                        className="text-primary hover:underline"
                      >
                        {s.id.slice(0, 8)}…
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-md">
                      <div className="line-clamp-2">{s.raw_text}</div>
                      {s.inference_summary && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {truncate(s.inference_summary, 120)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge s={s.inference_status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(s.inference_tags ?? []).slice(0, 4).map((t) => (
                          <Badge key={t} variant="outline">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(s.captured_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {q.hasNextPage && (
            <div className="flex justify-center border-t p-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => q.fetchNextPage()}
                disabled={q.isFetchingNextPage}
              >
                {q.isFetchingNextPage ? "加载中…" : "加载更多"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
