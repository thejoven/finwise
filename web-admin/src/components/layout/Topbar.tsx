import * as React from "react";
import { LogOut, Server, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { wiseflow, getApiBase } from "@/lib/api";

interface Props {
  onSignOut: () => void;
}

const THEME_KEY = "wiseflow.admin.theme";

export function Topbar({ onSignOut }: Props) {
  const [dark, setDark] = React.useState(() =>
    document.documentElement.classList.contains("dark"),
  );

  const { data: health, isError: healthError } = useQuery({
    queryKey: ["healthz"],
    queryFn: wiseflow.health,
    refetchInterval: 15_000,
    retry: 0,
  });

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: wiseflow.me, staleTime: 60_000 });

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(THEME_KEY, next ? "dark" : "light");
  };

  const status = healthError
    ? { label: "API down", tone: "bg-destructive" }
    : health?.status === "ok"
    ? { label: "API ok", tone: "bg-emerald-500" }
    : { label: "checking…", tone: "bg-muted-foreground" };

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-6">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Server className="h-4 w-4" />
        <span>{getApiBase()}</span>
        <span className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs">
          <span className={`h-1.5 w-1.5 rounded-full ${status.tone}`} />
          {status.label}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {me && (
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <span className="font-medium text-foreground">{me.email}</span>
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              管理员
            </span>
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          title="切换主题"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={onSignOut}>
          <LogOut className="mr-1.5 h-3.5 w-3.5" />
          退出
        </Button>
      </div>
    </header>
  );
}
