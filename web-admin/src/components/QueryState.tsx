import { AlertCircle, Loader2 } from "lucide-react";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="break-all">{msg}</span>
    </div>
  );
}

export function EmptyBox({ label = "没有数据" }: { label?: string }) {
  return (
    <div className="rounded-md border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
