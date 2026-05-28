import * as React from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearToken, getApiBase, getToken, setApiBase, setToken } from "@/lib/api";
import { useToast } from "@/components/ui/toaster";

export function SettingsPage() {
  const { toast } = useToast();
  const [base, setBase] = React.useState(getApiBase());
  const [token, setLocalToken] = React.useState(getToken() ?? "");

  const save = () => {
    setApiBase(base);
    setToken(token.trim());
    toast({
      title: "已保存",
      description: "API base + token 已写入 localStorage.",
      variant: "success",
    });
  };

  return (
    <div>
      <PageHeader
        title="设置"
        description="本地浏览器存储 (localStorage), 不上传."
      />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>连接配置</CardTitle>
          <CardDescription>切换不同 backend 时改这里.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="base">API Base URL</Label>
            <Input id="base" value={base} onChange={(e) => setBase(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="token">Bearer Token</Label>
            <Input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setLocalToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              对应 server <code>/opt/flashfi/.env</code> 的 DEV_BEARER_TOKEN.
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
          <Button onClick={save}>保存</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
