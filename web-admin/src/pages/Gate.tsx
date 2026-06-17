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

type Result = "" | "true" | "false";
const RESULTS: { v: Result; label: string }[] = [
  { v: "", label: "全部" },
  { v: "true", label: "通过" },
  { v: "false", label: "否决" },
];

export function GatePage() {
  const { focused } = useFocusedUser();
  const [passed, setPassed] = React.useState<Result>("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin", "gate", focused?.id ?? "all", passed],
    queryFn: () =>
      wiseflow.admin.gate.list({
        user_id: focused?.id,
        passed: passed === "" ? undefined : passed === "true",
      }),
  });
  const evals = data?.evaluations ?? [];

  return (
    <div>
      <PageHeader
        title="投决会"
        description={focused ? `聚焦用户 ${focused.email}` : "全用户四道门评估"}
      />
      <Card>
        <CardContent className="p-0">
          <div className="flex gap-1 border-b p-3">
            {RESULTS.map((r) => (
              <Button
                key={r.v}
                variant={passed === r.v ? "default" : "outline"}
                size="sm"
                onClick={() => setPassed(r.v)}
              >
                {r.label}
              </Button>
            ))}
          </div>

          {isLoading && <Loading />}
          {isError && (
            <div className="p-4">
              <ErrorBox error={error} />
            </div>
          )}
          {data && evals.length === 0 && <EmptyBox label="没有评估" />}
          {evals.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  {!focused && <TableHead>用户</TableHead>}
                  <TableHead>结果</TableHead>
                  <TableHead>失败门</TableHead>
                  <TableHead>归档池</TableHead>
                  <TableHead className="whitespace-nowrap">时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {evals.map((ev) => (
                  <TableRow key={ev.id}>
                    {!focused && (
                      <TableCell className="whitespace-nowrap text-xs">{ev.user_email}</TableCell>
                    )}
                    <TableCell>
                      <Badge variant={ev.passed ? "success" : "destructive"}>
                        {ev.passed ? "通过" : "否决"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {ev.failed_gate ? `G${ev.failed_gate}` : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ev.archived_pool || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(ev.evaluated_at)}
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
