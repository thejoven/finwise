import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

export function DistillationPage() {
  const { focused } = useFocusedUser();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin", "distillations", focused?.id ?? "all"],
    queryFn: () => alphax.admin.distillations.list({ user_id: focused?.id, limit: 100 }),
  });
  const rows = data?.distillations ?? [];

  return (
    <div>
      <PageHeader
        title="降噪"
        description={focused ? `聚焦用户 ${focused.email}` : "全用户降噪综述 · 受益标的"}
      />
      <Card>
        <CardContent className="p-0">
          {isLoading && <Loading />}
          {isError && (
            <div className="p-4">
              <ErrorBox error={error} />
            </div>
          )}
          {data && rows.length === 0 && <EmptyBox label="没有降噪记录" />}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  {!focused && <TableHead>用户</TableHead>}
                  <TableHead>综述预览</TableHead>
                  <TableHead>受益标的</TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead className="whitespace-nowrap">时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => (
                  <TableRow key={d.id}>
                    {!focused && (
                      <TableCell className="whitespace-nowrap text-xs">{d.user_email}</TableCell>
                    )}
                    <TableCell className="max-w-md truncate text-sm text-muted-foreground">
                      {d.content_preview || "—"}
                    </TableCell>
                    <TableCell>
                      {d.has_beneficiary ? (
                        <Badge variant="success">有</Badge>
                      ) : (
                        <Badge variant="outline">无</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{d.model}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(d.created_at)}
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
