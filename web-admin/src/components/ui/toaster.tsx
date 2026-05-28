import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastInput = {
  title?: string;
  description?: string;
  variant?: "default" | "destructive" | "success";
  durationMs?: number;
};

type ToastItem = ToastInput & { id: number; open: boolean };

const ToastContext = React.createContext<{
  toast: (t: ToastInput) => void;
} | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <Toaster />");
  return ctx;
}

const toastVariants = cva(
  "pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-md border p-4 pr-8 shadow-lg transition-all data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "border bg-background text-foreground",
        destructive:
          "border-destructive bg-destructive text-destructive-foreground",
        success:
          "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Toaster({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const counter = React.useRef(0);

  const toast = React.useCallback((t: ToastInput) => {
    counter.current += 1;
    const id = counter.current;
    setItems((prev) => [...prev, { ...t, id, open: true }]);
    const dur = t.durationMs ?? 4000;
    window.setTimeout(() => {
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, open: false } : i)),
      );
      window.setTimeout(() => {
        setItems((prev) => prev.filter((i) => i.id !== id));
      }, 300);
    }, dur);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            open={item.open}
            onOpenChange={(o) => {
              if (!o)
                setItems((prev) =>
                  prev.map((i) => (i.id === item.id ? { ...i, open: false } : i)),
                );
            }}
            className={cn(
              toastVariants({
                variant:
                  item.variant as VariantProps<typeof toastVariants>["variant"],
              }),
            )}
          >
            <div className="grid gap-1">
              {item.title && (
                <ToastPrimitive.Title className="text-sm font-semibold">
                  {item.title}
                </ToastPrimitive.Title>
              )}
              {item.description && (
                <ToastPrimitive.Description className="text-xs opacity-90">
                  {item.description}
                </ToastPrimitive.Description>
              )}
            </div>
            <ToastPrimitive.Close className="absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-70 transition-opacity hover:text-foreground hover:opacity-100">
              <X className="h-3.5 w-3.5" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:bottom-auto sm:right-0 sm:top-0 sm:flex-col md:max-w-[420px]" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
