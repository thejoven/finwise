import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
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
import { ErrorBox, Loading, EmptyBox } from "@/components/QueryState";
import { flashfi, type HoldingRow } from "@/lib/api";
import { formatDate } from "@/lib/utils";

export function HoldingsPage() {
  const q = useQuery({
    queryKey: ["holdings-active"],
    queryFn: flashfi.holdings.active,
  });
  const rows: HoldingRow[] = q.data ? [q.data] : [];

  return (
    <div>
      <PageHeader
        title="Holdings"
        description="陪伴中持仓 (M9). 由 commitment 签字后翻面而来."
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
          {q.data && rows.length === 0 && <EmptyBox label="当前没有活跃持仓" />}
          {q.data && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead>Closed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-mono text-xs">
                      {h.id.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="font-medium">{h.ticker ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={h.status === "closed" ? "outline" : "success"}
                      >
                        {h.status ?? "active"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(h.opened_at, "—")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(h.closed_at, "—")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
