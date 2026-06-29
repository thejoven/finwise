import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { clearToken, alphax, getApiBase, getToken, setApiBase, setToken, type StorageConfigInput } from "@/lib/api";
import { useToast } from "@/components/ui/toaster";

export function SettingsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: alphax.me, staleTime: 60_000 });

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
    mutationFn: () => alphax.changePassword(oldPw, newPw),
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
          {me ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium">{me.email}</span>
              {me.is_admin ? (
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

      <StorageCard />
    </div>
  );
}

// StorageCard — 对象存储 (R2) 凭证后台配置. 持久化到服务端 app_settings,
// 头像上传 (预签名直传) + 私有读代理依赖它. secret 写时输入、读时不回传.
function StorageCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin", "settings", "storage"],
    queryFn: alphax.admin.settings.storage.get,
  });

  const [form, setForm] = React.useState<StorageConfigInput>({
    enabled: false,
    account_id: "",
    endpoint: "",
    region: "auto",
    bucket: "",
    access_key_id: "",
    secret_access_key: "",
  });
  const [secretConfigured, setSecretConfigured] = React.useState(false);

  React.useEffect(() => {
    if (!data) return;
    setForm({
      enabled: data.enabled,
      account_id: data.account_id,
      endpoint: data.endpoint,
      region: data.region || "auto",
      bucket: data.bucket,
      access_key_id: data.access_key_id,
      secret_access_key: "", // 写时输入, 不回填
    });
    setSecretConfigured(data.secret_configured);
  }, [data]);

  const setField =
    (k: keyof StorageConfigInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const saveMut = useMutation({
    mutationFn: () =>
      alphax.admin.settings.storage.update({
        enabled: form.enabled,
        account_id: form.account_id.trim(),
        endpoint: (form.endpoint ?? "").trim(),
        region: (form.region ?? "").trim() || "auto",
        bucket: form.bucket.trim(),
        access_key_id: form.access_key_id.trim(),
        // 留空不传 → 后端保留原 secret
        secret_access_key: form.secret_access_key ? form.secret_access_key : undefined,
      }),
    onSuccess: (cfg) => {
      toast({ title: "已保存", description: "对象存储配置已更新.", variant: "success" });
      setSecretConfigured(cfg.secret_configured);
      setForm((f) => ({ ...f, secret_access_key: "" }));
      qc.invalidateQueries({ queryKey: ["admin", "settings", "storage"] });
    },
    onError: (err) =>
      toast({
        title: "保存失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });

  const testMut = useMutation({
    mutationFn: () => alphax.admin.settings.storage.test(),
    onSuccess: (r) =>
      r.ok
        ? toast({ title: "连接成功", description: "桶可访问.", variant: "success" })
        : toast({ title: "连接失败", description: r.error ?? "未知错误", variant: "destructive" }),
    onError: (err) =>
      toast({
        title: "测试失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>对象存储 (R2)</CardTitle>
        <CardDescription>
          头像上传/读取的对象存储凭证. 兼容 Cloudflare R2 与 S3-compatible (自托管 MinIO). 留空 Secret = 保留原值.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
          />
          启用 (关闭后头像上传/读取返回 503)
        </label>
        <div className="space-y-2">
          <Label htmlFor="r2-account">Account ID</Label>
          <Input
            id="r2-account"
            value={form.account_id}
            onChange={setField("account_id")}
            placeholder="Cloudflare 账号 ID (endpoint 由它派生)"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="r2-endpoint">Endpoint (可选)</Label>
          <Input
            id="r2-endpoint"
            value={form.endpoint}
            onChange={setField("endpoint")}
            placeholder="留空 = <account>.r2.cloudflarestorage.com; 自托管 MinIO 填这里"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="r2-bucket">Bucket</Label>
            <Input id="r2-bucket" value={form.bucket} onChange={setField("bucket")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="r2-region">Region</Label>
            <Input id="r2-region" value={form.region} onChange={setField("region")} placeholder="auto" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="r2-akid">Access Key ID</Label>
          <Input id="r2-akid" value={form.access_key_id} onChange={setField("access_key_id")} autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="r2-secret">Secret Access Key</Label>
          <Input
            id="r2-secret"
            type="password"
            value={form.secret_access_key ?? ""}
            onChange={setField("secret_access_key")}
            autoComplete="off"
            placeholder={secretConfigured ? "已配置 (留空保留)" : "未配置"}
          />
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline" onClick={() => testMut.mutate()} disabled={testMut.isPending || saveMut.isPending}>
          {testMut.isPending ? "测试中…" : "测试连接"}
        </Button>
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          {saveMut.isPending ? "保存中…" : "保存"}
        </Button>
      </CardFooter>
    </Card>
  );
}
