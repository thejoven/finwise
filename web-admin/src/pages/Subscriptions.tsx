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

export function SubscriptionsPage() {
  const { focused } = useFocusedUser();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin", "subscriptions", focused?.id ?? "all"],
    queryFn: () => alphax.admin.subscriptions.list({ user_id: focused?.id }),
  });
  const accounts = data?.accounts ?? [];

  return (
    <div>
      <PageHeader
        title="订阅源"
        description={
          focused ? `聚焦用户 ${focused.email} 订阅的账号` : "全部 X 订阅源 · 采集与轮询"
        }
      />
      <Card>
        <CardContent className="p-0">
          {isLoading && <Loading />}
          {isError && (
            <div className="p-4">
              <ErrorBox error={error} />
            </div>
          )}
          {data && accounts.length === 0 && <EmptyBox label="没有订阅源" />}
          {accounts.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>账号</TableHead>
                  <TableHead className="text-right">订阅人数</TableHead>
                  <TableHead className="text-right">推文数</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="whitespace-nowrap">上次轮询</TableHead>
                  <TableHead className="text-right">间隔</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      @{a.handle}
                      {a.display_name && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          {a.display_name}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.subscriber_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.tweet_count}</TableCell>
                    <TableCell>
                      <Badge variant={a.status === "active" ? "success" : "outline"}>
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {a.last_polled_at ? formatDate(a.last_polled_at) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {Math.round(a.poll_interval_sec / 60)}m
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
