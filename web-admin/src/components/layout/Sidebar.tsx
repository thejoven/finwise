import * as React from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Activity,
  ClipboardCheck,
  Briefcase,
  History,
  Inbox,
  LayoutDashboard,
  ShieldCheck,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
}

const nav: NavItem[] = [
  { to: "/", label: "概览", icon: LayoutDashboard },
  { to: "/signals", label: "信号 Signals", icon: Inbox, hint: "M1" },
  { to: "/refinements", label: "追问 Refinement", icon: Sparkles, hint: "M5" },
  { to: "/gate", label: "四道门 Gate", icon: ShieldCheck, hint: "M6" },
  { to: "/commitments", label: "承诺 Commitments", icon: ClipboardCheck, hint: "M7-8" },
  { to: "/holdings", label: "持仓 Holdings", icon: Briefcase, hint: "M9" },
  { to: "/retrospects", label: "复盘 Retrospects", icon: History, hint: "M11" },
  { to: "/metrics", label: "Metrics", icon: Activity },
  { to: "/settings", label: "设置", icon: SettingsIcon },
];

export function Sidebar() {
  const location = useLocation();
  // re-render-only: keep location subscribed
  void location.pathname;

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar text-sidebar-foreground md:flex md:flex-col">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
          F
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">Flashfi</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Admin · 内网
          </span>
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-3 text-sm">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-2 rounded-md px-3 py-2 transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.label}</span>
            {item.hint && (
              <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {item.hint}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-3 text-[10px] text-muted-foreground">
        <p>backend · 192.168.1.205:8080</p>
        <p className="mt-1">© Flashfi Engine</p>
      </div>
    </aside>
  );
}
