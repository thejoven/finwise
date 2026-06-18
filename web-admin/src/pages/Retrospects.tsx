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

type State = "" | "pending" | "answered" | "finalized";
const STATES: { v: State; label: string }[] = [
  { v: "", label: "全部" },
  { v: "pending", label: "pending" },
  { v: "answered", label: "answered" },
  { v: "finalized", label: "finalized" },
];

function stateVariant(s: string): "success" | "warning" | "outline" {
  return s === "finalized" ? "success" : s === "answered" ? "warning" : "outline";
}

export function RetrospectsPage() {
  const { focused } = useFocusedUser();
  const [state, setState] = React.useState<State>("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin", "retrospects", focused?.id ?? "all", state],
    queryFn: () =>
      alphax.admin.retrospects.list({ user_id: focused?.id, state: state || undefined, limit: 100 }),
  });
  const rows = data?.retrospects ?? [];

  return (
    <div>
      <PageHeader
        title="复盘"
        description={focused ? `聚焦用户 ${focused.email}` : "全用户复盘训练"}
      />
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap gap-1 border-b p-3">
            {STATES.map((s) => (
              <Button
                key={s.v}
                variant={state === s.v ? "default" : "outline"}
                size="sm"
                onClick={() => setState(s.v)}
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
          {data && rows.length === 0 && <EmptyBox label="没有复盘" />}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  {!focused && <TableHead>用户</TableHead>}
                  <TableHead>状态</TableHead>
                  <TableHead>维度</TableHead>
                  <TableHead className="whitespace-nowrap">开始</TableHead>
                  <TableHead className="whitespace-nowrap">完成</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    {!focused && (
                      <TableCell className="whitespace-nowrap text-xs">{r.user_email}</TableCell>
                    )}
                    <TableCell>
                      <Badge variant={stateVariant(r.state)}>{r.state}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.focus_dim || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(r.started_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {r.finalized_at ? formatDate(r.finalized_at) : "—"}
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
