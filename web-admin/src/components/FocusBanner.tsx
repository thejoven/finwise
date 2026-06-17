import { UserCheck, X } from "lucide-react";
import { useFocusedUser } from "@/lib/focusedUser";

// 聚焦横幅 — 选中用户时浮现于 Topbar 下方; 提示当前作用域 + 退出聚焦.
export function FocusBanner() {
  const { focused, clear } = useFocusedUser();
  if (!focused) return null;
  return (
    <div className="flex items-center gap-2 border-b bg-primary/10 px-6 py-2 text-sm">
      <UserCheck className="h-4 w-4 shrink-0 text-primary" />
      <span className="text-foreground">
        正在聚焦用户 <span className="font-medium">{focused.email}</span>
        <span className="text-muted-foreground"> — 各域页数据已收窄到该用户。</span>
      </span>
      <button
        onClick={clear}
        className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
        退出聚焦
      </button>
    </div>
  );
}
