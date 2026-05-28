import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ErrorBox, Loading } from "@/components/QueryState";
import { flashfi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/toaster";

export function RefinementsPage() {
  const { toast } = useToast();
  const [signalId, setSignalId] = React.useState("");
  const [activeSignalId, setActiveSignalId] = React.useState<string | null>(null);

  const session = useQuery({
    queryKey: ["refinement-by-signal", activeSignalId],
    queryFn: () => flashfi.refinement.bySignal(activeSignalId!),
    enabled: !!activeSignalId,
    retry: 0,
  });

  const start = useMutation({
    mutationFn: (sid: string) => flashfi.refinement.start(sid),
    onSuccess: () => {
      toast({ title: "已开启会话", variant: "success" });
      session.refetch();
    },
    onError: (err) =>
      toast({
        title: "开启失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });

  return (
    <div>
      <PageHeader
        title="Refinement"
        description="M5 五轮追问会话. 按 signal_id 查询或新开."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>按 Signal 查询</CardTitle>
            <CardDescription>填 signal_id, 查它的会话状态.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setActiveSignalId(signalId.trim() || null);
              }}
              className="flex gap-2"
            >
              <div className="flex-1 space-y-2">
                <Label htmlFor="sid" className="sr-only">
                  signal_id
                </Label>
                <Input
                  id="sid"
                  value={signalId}
                  onChange={(e) => setSignalId(e.target.value)}
                  placeholder="signal_id (UUID)"
                />
              </div>
              <Button type="submit" variant="outline">
                查询
              </Button>
              <Button
                type="button"
                disabled={!signalId.trim() || start.isPending}
                onClick={() => signalId.trim() && start.mutate(signalId.trim())}
              >
                {start.isPending ? "开启中…" : "新开会话"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>当前会话</CardTitle>
            <CardDescription>
              {activeSignalId ? `signal=${activeSignalId.slice(0, 8)}…` : "未指定"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!activeSignalId && (
              <p className="text-xs text-muted-foreground">
                先在左侧输入 signal_id.
              </p>
            )}
            {activeSignalId && session.isLoading && <Loading />}
            {activeSignalId && session.isError && (
              <ErrorBox error={session.error} />
            )}
            {session.data && (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">session_id</span>
                  <span className="font-mono text-xs">{String(session.data.id)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">status</span>
                  <Badge variant="outline">{String(session.data.status)}</Badge>
                </div>
                <Separator />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>created</span>
                  <span>{formatDate(session.data.created_at)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>updated</span>
                  <span>{formatDate(session.data.updated_at)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
