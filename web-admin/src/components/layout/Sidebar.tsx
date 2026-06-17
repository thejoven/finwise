import * as React from "react";
import { NavLink } from "react-router-dom";
import {
  Activity,
  Briefcase,
  Cpu,
  Filter,
  FolderTree,
  History,
  Inbox,
  LayoutDashboard,
  MessagesSquare,
  Rss,
  Settings as SettingsIcon,
  ShieldCheck,
  Ticket,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  // soon: 页面尚未在本次重构中接入 (后续切片实现), 给个 hint 但仍可点 (占位页).
  soon?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// 信息架构按"运营职责"分组, 取代旧的 M1→M11 里程碑流水线.
const groups: NavGroup[] = [
  {
    label: "总览",
    items: [{ to: "/", label: "仪表盘", icon: LayoutDashboard }],
  },
  {
    label: "接入 · 信号",
    items: [
      { to: "/subscriptions", label: "订阅源", icon: Rss },
      { to: "/signals", label: "信号流", icon: Inbox },
      { to: "/projects", label: "项目分类", icon: FolderTree },
    ],
  },
  {
    label: "研判流水线",
    items: [
      { to: "/distillation", label: "降噪", icon: Filter },
      { to: "/refinements", label: "追问", icon: MessagesSquare },
      { to: "/gate", label: "投决会", icon: ShieldCheck },
      { to: "/positions", label: "承诺 · 持仓", icon: Briefcase },
      { to: "/retrospects", label: "复盘", icon: History },
    ],
  },
  {
    label: "运行观测",
    items: [
      { to: "/inference", label: "AI 流水线", icon: Cpu },
      { to: "/metrics", label: "指标", icon: Activity },
    ],
  },
  {
    label: "管理",
    items: [
      { to: "/users", label: "用户", icon: Users },
      { to: "/invites", label: "邀请码", icon: Ticket },
      { to: "/settings", label: "系统设置", icon: SettingsIcon },
    ],
  },
];

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-14 items-center gap-2.5 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
          W
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">WiseFlow</span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            运营后台
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto p-3 text-sm">
        {groups.map((g) => (
          <div key={g.label} className="space-y-0.5">
            <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
              {g.label}
            </p>
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "group flex items-center gap-2.5 rounded-md px-3 py-2 transition-colors",
                    isActive
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  )
                }
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
                {item.soon && (
                  <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                    soon
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t p-3 text-[10px] text-muted-foreground">
        <p className="font-mono">192.168.1.205 · 内网</p>
        <p className="mt-0.5">© WiseFlow Engine</p>
      </div>
    </aside>
  );
}
