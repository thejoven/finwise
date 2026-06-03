import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorBox, Loading } from "@/components/QueryState";
import { wiseflow } from "@/lib/api";
import { RefreshCw } from "lucide-react";

interface MetricLine {
  name: string;
  labels: string;
  value: string;
}

function parseMetrics(text: string): { help: Record<string, string>; lines: MetricLine[] } {
  const lines: MetricLine[] = [];
  const help: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    if (!raw) continue;
    if (raw.startsWith("# HELP ")) {
      const m = raw.match(/^# HELP (\S+) (.+)$/);
      if (m) help[m[1]] = m[2];
      continue;
    }
    if (raw.startsWith("#")) continue;
    const m = raw.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(.+)$/);
    if (!m) continue;
    lines.push({ name: m[1], labels: m[2] ?? "", value: m[3] });
  }
  return { help, lines };
}

export function MetricsPage() {
  const q = useQuery({
    queryKey: ["metrics"],
    queryFn: wiseflow.metrics,
    refetchInterval: 10_000,
  });
  const [filter, setFilter] = React.useState("");

  const parsed = q.data ? parseMetrics(q.data) : null;
  const filtered = parsed
    ? parsed.lines.filter((l) =>
        filter ? (l.name + l.labels).toLowerCase().includes(filter.toLowerCase()) : true,
      )
    : [];

  return (
    <div>
      <PageHeader
        title="Metrics"
        description="Prometheus exposition, /metrics 端点直读."
        actions={
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />
            刷新
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>采集结果</CardTitle>
          <CardDescription>
            10s 自动刷新. 按 name/labels 过滤.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="过滤: http_requests / outbox / ..."
            className="mb-3 h-9 w-full max-w-sm rounded-md border bg-transparent px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {q.isLoading && <Loading />}
          {q.isError && <ErrorBox error={q.error} />}
          {parsed && (
            <div className="max-h-[60vh] overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-2 py-1.5 text-left">name</th>
                    <th className="px-2 py-1.5 text-left">labels</th>
                    <th className="px-2 py-1.5 text-right">value</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 500).map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1 font-mono">{l.name}</td>
                      <td className="px-2 py-1 font-mono text-muted-foreground">{l.labels}</td>
                      <td className="px-2 py-1 text-right font-mono">{l.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
