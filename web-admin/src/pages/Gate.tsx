import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ErrorBox, Loading, EmptyBox } from "@/components/QueryState";
import { flashfi } from "@/lib/api";

// matches domain.ArchivePool in server/internal/domain/phase2.go
const POOLS = ["observation", "lesson", "calendar", "discard"];

export function GatePage() {
  const [pool, setPool] = React.useState(POOLS[0]);
  const [evalId, setEvalId] = React.useState("");
  const [activeEvalId, setActiveEvalId] = React.useState<string | null>(null);

  const list = useQuery({
    queryKey: ["gate-pool", pool],
    queryFn: () => flashfi.gate.pool(pool),
    retry: 0,
  });

  const detail = useQuery({
    queryKey: ["gate-eval", activeEvalId],
    queryFn: () => flashfi.gate.get(activeEvalId!),
    enabled: !!activeEvalId,
    retry: 0,
  });

  return (
    <div>
      <PageHeader
        title="Gate"
        description="M6 四道门. 评估池里堆积的待评 + 单次结果查询."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>按 pool 列出</CardTitle>
            <CardDescription>切换不同评估池.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex gap-2">
              {POOLS.map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={p === pool ? "default" : "outline"}
                  onClick={() => setPool(p)}
                >
                  {p}
                </Button>
              ))}
            </div>
            {list.isLoading && <Loading />}
            {list.isError && <ErrorBox error={list.error} />}
            {list.data && (list.data.evaluations ?? []).length === 0 && (
              <EmptyBox label={`pool=${pool} 没有评估`} />
            )}
            {list.data && (list.data.evaluations ?? []).length > 0 && (
              <ul className="space-y-1 text-sm">
                {list.data.evaluations.map((e) => (
                  <li key={e.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <span className="font-mono text-xs">{e.id.slice(0, 12)}…</span>
                    <Badge variant="outline">{String(e.status ?? "—")}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>按 ID 查询</CardTitle>
            <CardDescription>评估结果详情.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setActiveEvalId(evalId.trim() || null);
              }}
              className="mb-3 flex gap-2"
            >
              <Label htmlFor="eid" className="sr-only">evaluation id</Label>
              <Input
                id="eid"
                value={evalId}
                onChange={(e) => setEvalId(e.target.value)}
                placeholder="evaluation_id"
              />
              <Button type="submit" variant="outline">查询</Button>
            </form>
            {activeEvalId && detail.isLoading && <Loading />}
            {activeEvalId && detail.isError && <ErrorBox error={detail.error} />}
            {detail.data && (
              <pre className="overflow-auto rounded-md bg-muted/40 p-3 text-xs">
                {JSON.stringify(detail.data, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
