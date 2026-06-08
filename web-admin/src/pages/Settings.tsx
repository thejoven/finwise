import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { clearToken, wiseflow, getApiBase, getToken, setApiBase, setToken } from "@/lib/api";
import { useToast } from "@/components/ui/toaster";

export function SettingsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: wiseflow.me, staleTime: 60_000 });

  const [base, setBase] = React.useState(() => getApiBase());
  const [token, setLocalToken] = React.useState(getToken() ?? "");

  const [oldPw, setOldPw] = React.useState("");
  const [newPw, setNewPw] = React.useState("");

  const saveConn = () => {
    setApiBase(base);
    setToken(token.trim());
    toast({
      title: "已保存",
      description: "API base + token 已写入 localStorage.",
      variant: "success",
    });
  };

  const changePw = useMutation({
    mutationFn: () => wiseflow.changePassword(oldPw, newPw),
    onSuccess: () => {
      toast({
        title: "密码已修改",
        description: "为安全起见, 已吊销所有会话, 请重新登录.",
        variant: "success",
      });
      qc.invalidateQueries({ queryKey: ["me"] });
      clearToken();
      setTimeout(() => location.reload(), 800);
    },
    onError: (err) => {
      toast({
        title: "修改失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="设置" description="账号与本地连接配置." />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>当前账号</CardTitle>
          <CardDescription>已登录的管理员身份.</CardDescription>
        </CardHeader>
        <CardContent>
          {me.data ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium">{me.data.email}</span>
              {me.data.is_admin ? (
                <Badge variant="success">管理员</Badge>
              ) : (
                <Badge variant="outline">用户</Badge>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">加载中…</p>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>修改密码</CardTitle>
          <CardDescription>修改后会吊销所有会话, 需重新登录.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="oldpw">当前密码</Label>
            <Input id="oldpw" type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newpw">新密码 (至少 8 位)</Label>
            <Input id="newpw" type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            onClick={() => changePw.mutate()}
            disabled={changePw.isPending || !oldPw || newPw.length < 8}
          >
            {changePw.isPending ? "提交中…" : "修改密码"}
          </Button>
        </CardFooter>
      </Card>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>连接配置</CardTitle>
          <CardDescription>切换不同 backend 时改这里 (存浏览器 localStorage, 不上传).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="base">API Base URL</Label>
            <Input id="base" value={base} onChange={(e) => setBase(e.target.value)} placeholder="(空 = 同源 nginx 反代)" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="token">Bearer Token (session / dev)</Label>
            <Input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setLocalToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              正常由邮箱登录自动写入 (session token). 也可手填 DEV_BEARER_TOKEN 调试.
            </p>
          </div>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              clearToken();
              location.reload();
            }}
          >
            清除并重登
          </Button>
          <Button onClick={saveConn}>保存</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
