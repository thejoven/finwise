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
import { flashfi } from "@/lib/api";
import { formatDate } from "@/lib/utils";

export function RetrospectsPage() {
  const q = useQuery({
    queryKey: ["retrospects"],
    queryFn: flashfi.retrospects.list,
  });
  const rows = q.data?.retrospects ?? [];

  return (
    <div>
      <PageHeader
        title="Retrospects"
        description="复盘训练 (M11). 状态流: pending → answered → finalized."
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
          {q.data && rows.length === 0 && <EmptyBox label="还没有复盘记录" />}
          {q.data && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Finalized</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      {r.id.slice(0, 8)}…
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "finalized"
                            ? "success"
                            : r.status === "answered"
                            ? "warning"
                            : "outline"
                        }
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(r.created_at)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(r.finalized_at, "—")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(r.updated_at)}
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
