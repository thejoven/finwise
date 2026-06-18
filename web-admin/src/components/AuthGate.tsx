import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ApiError, clearToken, alphax, getApiBase, setApiBase, setToken } from "@/lib/api";

interface Props {
  onSignedIn: () => void;
}

interface AuthState {
  base: string;
  showAdvanced: boolean;
  email: string;
  password: string;
  devToken: string;
  busy: boolean;
  error: string | null;
}

function reduce(s: AuthState, patch: Partial<AuthState>): AuthState {
  return { ...s, ...patch };
}

// 后台只允许管理员登录. 主路径: 邮箱+密码 → /v1/auth/login → 校验 is_admin.
// 折叠的"高级"里保留: (a) API Base URL 覆盖; (b) Dev Token 应急登录 (落到 DevUserID,
// 服务端视为管理员). 默认走同源 (nginx 反代到 :8080).
export function AuthGate({ onSignedIn }: Props) {
  const initialBase = getApiBase();
  const [state, set] = React.useReducer(reduce, {
    base: initialBase,
    showAdvanced: !!initialBase,
    email: "",
    password: "",
    devToken: "",
    busy: false,
    error: null,
  });
  const { base, showAdvanced, email, password, devToken, busy, error } = state;

  const explainFetchError = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "Failed to fetch" || (err instanceof TypeError && msg.includes("fetch"))) {
      return base.trim()
        ? "Failed to fetch — 通常是跨域 (CORS) 或网络不通. 把 'API Base URL' 清空走同源 (nginx 反代) 通常能解."
        : "Failed to fetch — 后端没回 (检查 :8080 是否在跑, nginx 反代是否正常).";
    }
    return msg;
  };

  // 邮箱+密码登录.
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    set({ busy: true });
    set({ error: null });
    setApiBase(base.trim());
    try {
      const resp = await alphax.auth.login(email.trim(), password);
      setToken(resp.session.token);
      if (!resp.user.is_admin) {
        // 非管理员: 立即清 token, 不放进后台.
        clearToken();
        set({ error: "此账号不是管理员, 无权进入后台. 请用管理员邮箱登录." });
        return;
      }
      onSignedIn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        set({ error: "邮箱或密码错误." });
      } else {
        set({ error: explainFetchError(err) });
      }
    } finally {
      set({ busy: false });
    }
  };

  // Dev Token 应急登录: 落到 DevUserID, 服务端 RequireAdmin 认它为管理员.
  const handleDevToken = async () => {
    set({ busy: true });
    set({ error: null });
    setApiBase(base.trim());
    setToken(devToken.trim());
    try {
      const me = await alphax.me(); // dev 占位行 is_admin=true
      if (!me.is_admin) {
        clearToken();
        set({ error: "该 token 对应的账号不是管理员." });
        return;
      }
      onSignedIn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        set({ error: "401 Unauthorized — Dev Token 不对." });
      } else {
        set({ error: explainFetchError(err) });
      }
    } finally {
      set({ busy: false });
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>AlphaX Admin</CardTitle>
          <CardDescription>
            管理员登录. 仅 <code>is_admin</code> 账号可进入后台.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => set({ email: e.target.value })}
                placeholder="jwen@vip.qq.com"
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => set({ password: e.target.value })}
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="button"
              onClick={() => set({ showAdvanced: !showAdvanced })}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              高级: API Base URL / Dev Token
            </button>

            {showAdvanced && (
              <div className="space-y-4 rounded-md border border-dashed p-3">
                <div className="space-y-2">
                  <Label htmlFor="base">API Base URL (留空 = 走同源 nginx 反代)</Label>
                  <Input
                    id="base"
                    value={base}
                    onChange={(e) => set({ base: e.target.value })}
                    placeholder="(空)"
                  />
                  <p className="text-xs text-muted-foreground">
                    填绝对 URL (如 <code>http://192.168.1.205:8080</code>) 时, Go API 必须发 CORS 头.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="devtoken">Dev Token 应急登录 (DEV_BEARER_TOKEN)</Label>
                  <Input
                    id="devtoken"
                    type="password"
                    value={devToken}
                    onChange={(e) => set({ devToken: e.target.value })}
                    placeholder="uaR0Gc..."
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={busy || !devToken.trim()}
                    onClick={handleDevToken}
                  >
                    用 Dev Token 登录
                  </Button>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={busy || !email.trim() || !password}>
              {busy ? "正在登录…" : "登录"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
