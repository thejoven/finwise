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
import { wiseflow } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useFocusedUser } from "@/lib/focusedUser";

const STATUSES = ["", "active", "triggered", "expired", "closed", "archived"];

function statusVariant(s: string): "success" | "warning" | "outline" {
  return s === "active" ? "success" : s === "triggered" ? "warning" : "outline";
}

export function PositionsPage() {
  const { focused } = useFocusedUser();
  const [status, setStatus] = React.useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin", "holdings", focused?.id ?? "all", status],
    queryFn: () =>
      wiseflow.admin.holdings.list({ user_id: focused?.id, status: status || undefined }),
  });
  const holdings = data?.holdings ?? [];

  return (
    <div>
      <PageHeader
        title="承诺 · 持仓"
        description={focused ? `聚焦用户 ${focused.email}` : "全用户持仓 · 状态机"}
      />
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap gap-1 border-b p-3">
            {STATUSES.map((s) => (
              <Button
                key={s}
                variant={status === s ? "default" : "outline"}
                size="sm"
                onClick={() => setStatus(s)}
              >
                {s === "" ? "全部" : s}
              </Button>
            ))}
          </div>

          {isLoading && <Loading />}
          {isError && (
            <div className="p-4">
              <ErrorBox error={error} />
            </div>
          )}
          {data && holdings.length === 0 && <EmptyBox label="没有持仓" />}
          {holdings.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  {!focused && <TableHead>用户</TableHead>}
                  <TableHead>标的</TableHead>
                  <TableHead>动作</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="whitespace-nowrap">签字</TableHead>
                  <TableHead className="whitespace-nowrap">到期</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holdings.map((h) => (
                  <TableRow key={h.id}>
                    {!focused && (
                      <TableCell className="whitespace-nowrap text-xs">{h.user_email}</TableCell>
                    )}
                    <TableCell className="font-medium">{h.ticker || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{h.action || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(h.status)}>{h.status}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(h.signed_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(h.expires_at)}
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
