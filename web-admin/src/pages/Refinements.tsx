import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loading, ErrorBox, EmptyBox } from "@/components/QueryState";
import { alphax } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useFocusedUser } from "@/lib/focusedUser";

type Status = "" | "active" | "completed" | "abandoned";
const STATUSES: { v: Status; label: string }[] = [
  { v: "", label: "全部" },
  { v: "active", label: "active" },
  { v: "completed", label: "completed" },
  { v: "abandoned", label: "abandoned" },
];

function statusVariant(s: string): "success" | "warning" | "outline" {
  return s === "completed" ? "success" : s === "active" ? "warning" : "outline";
}

export function RefinementsPage() {
  const { focused } = useFocusedUser();
  const [status, setStatus] = React.useState<Status>("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin", "refinement", focused?.id ?? "all", status],
    queryFn: () =>
      alphax.admin.refinement.list({ user_id: focused?.id, status: status || undefined, limit: 100 }),
  });
  const rows = data?.sessions ?? [];

  return (
    <div>
      <PageHeader
        title="追问"
        description={focused ? `聚焦用户 ${focused.email}` : "全用户五轮追问会话"}
      />
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap gap-1 border-b p-3">
            {STATUSES.map((s) => (
              <Button
                key={s.v}
                variant={status === s.v ? "default" : "outline"}
                size="sm"
                onClick={() => setStatus(s.v)}
              >
                {s.label}
              </Button>
            ))}
          </div>

          {isLoading && <Loading />}
          {isError && (
            <div className="p-4">
              <ErrorBox error={error} />
            </div>
          )}
          {data && rows.length === 0 && <EmptyBox label="没有会话" />}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  {!focused && <TableHead>用户</TableHead>}
                  <TableHead>信号摘要</TableHead>
                  <TableHead className="text-right">轮次</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>决定</TableHead>
                  <TableHead className="whitespace-nowrap">开始</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id}>
                    {!focused && (
                      <TableCell className="whitespace-nowrap text-xs">{s.user_email}</TableCell>
                    )}
                    <TableCell className="max-w-md truncate text-sm">
                      {s.signal_summary || s.primary_asset || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.rounds_done}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.decision || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(s.started_at)}
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
