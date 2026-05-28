import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ApiError, flashfi, getApiBase, getToken, setApiBase, setToken } from "@/lib/api";

interface Props {
  onSignedIn: () => void;
}

// Empty string = use same-origin (admin served by nginx that reverse-proxies the
// Go API). Anything else = absolute URL, which only works if the API serves
// CORS headers. We default to empty and hide the override behind "高级".
export function AuthGate({ onSignedIn }: Props) {
  const initialBase = getApiBase();
  const [base, setBase] = React.useState(initialBase);
  const [showAdvanced, setShowAdvanced] = React.useState(!!initialBase);
  const [token, setLocalToken] = React.useState(getToken() ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Trim trailing slashes; empty stays empty (= same-origin).
    setApiBase(base.trim());
    setToken(token.trim());
    try {
      const h = await flashfi.health();
      if (h.status !== "ok") {
        throw new Error(`server reports status=${h.status}`);
      }
      // Now try one authenticated probe to verify the token works.
      await flashfi.signals.list();
      onSignedIn();
    } catch (err) {
      let msg = err instanceof Error ? err.message : String(err);
      // The browser surfaces all CORS / network failures as "Failed to fetch".
      // If the user has set an absolute base URL, that's almost always the cause.
      if (msg === "Failed to fetch" || (err instanceof TypeError && msg.includes("fetch"))) {
        if (base.trim()) {
          msg =
            "Failed to fetch — 通常是跨域 (CORS) 或网络不通. " +
            "把 'API Base URL' 清空让浏览器走当前域名 (nginx 反代) 通常能解.";
        } else {
          msg = "Failed to fetch — 后端没回 (检查 :8080 是否在跑, nginx 反代是否正常).";
        }
      } else if (err instanceof ApiError && err.status === 401) {
        msg = "401 Unauthorized — token 不对.";
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Flashfi Admin</CardTitle>
          <CardDescription>
            输入 Bearer Token 登录. API 通过当前域名同源访问 (nginx 反代到 :8080).
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">Bearer Token (DEV_BEARER_TOKEN)</Label>
              <Input
                id="token"
                type="password"
                value={token}
                onChange={(e) => setLocalToken(e.target.value)}
                placeholder="uaR0Gc..."
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                同 server <code>/opt/flashfi/.env</code> 里的 DEV_BEARER_TOKEN.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              高级: 自定义 API Base URL
            </button>

            {showAdvanced && (
              <div className="space-y-2 rounded-md border border-dashed p-3">
                <Label htmlFor="base">API Base URL (留空 = 走同源 nginx 反代)</Label>
                <Input
                  id="base"
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  placeholder="(空)"
                />
                <p className="text-xs text-muted-foreground">
                  填绝对 URL (如 <code>http://192.168.1.205:8080</code>) 时, Go API 必须发 CORS 头,
                  否则浏览器会报 "Failed to fetch".
                </p>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "正在连接…" : "登录"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
