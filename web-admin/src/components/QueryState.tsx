import { AlertCircle, Loader2 } from "lucide-react";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

// Loading / ErrorBox / EmptyBox 是一组配套的查询态原子组件, 各页面成组按 barrel 导入,
// 拆成单文件只会割裂这组共用工具并徒增 11 处导入改动, 故保留同文件.
// react-doctor-disable-next-line react-doctor/no-multi-comp
export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="break-all">{msg}</span>
    </div>
  );
}

// 同上: 与 Loading / ErrorBox 配套的查询态原子组件, 保留同文件.
// react-doctor-disable-next-line react-doctor/no-multi-comp
export function EmptyBox({ label = "没有数据" }: { label?: string }) {
  return (
    <div className="rounded-md border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
