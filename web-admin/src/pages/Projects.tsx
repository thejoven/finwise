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

export function ProjectsPage() {
  const { focused } = useFocusedUser();
  const [includeArchived, setIncludeArchived] = React.useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin", "projects", focused?.id ?? "all", includeArchived],
    queryFn: () =>
      alphax.admin.projects.list({
        user_id: focused?.id,
        include_archived: includeArchived,
        limit: 200,
      }),
  });
  const rows = data?.projects ?? [];

  return (
    <div>
      <PageHeader
        title="项目分类"
        description={focused ? `聚焦用户 ${focused.email}` : "全用户项目 / 分类"}
      />
      <Card>
        <CardContent className="p-0">
          <div className="flex gap-1 border-b p-3">
            <Button
              variant={!includeArchived ? "default" : "outline"}
              size="sm"
              onClick={() => setIncludeArchived(false)}
            >
              仅活跃
            </Button>
            <Button
              variant={includeArchived ? "default" : "outline"}
              size="sm"
              onClick={() => setIncludeArchived(true)}
            >
              含归档
            </Button>
          </div>

          {isLoading && <Loading />}
          {isError && (
            <div className="p-4">
              <ErrorBox error={error} />
            </div>
          )}
          {data && rows.length === 0 && <EmptyBox label="没有项目" />}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  {!focused && <TableHead>用户</TableHead>}
                  <TableHead>名称</TableHead>
                  <TableHead className="text-right">信号数</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="whitespace-nowrap">创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    {!focused && (
                      <TableCell className="whitespace-nowrap text-xs">{p.user_email}</TableCell>
                    )}
                    <TableCell className="font-medium">
                      {p.emoji && <span className="mr-1.5">{p.emoji}</span>}
                      {p.name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.signal_count}</TableCell>
                    <TableCell>
                      {p.archived ? (
                        <Badge variant="outline">已归档</Badge>
                      ) : (
                        <Badge variant="success">活跃</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(p.created_at)}
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
