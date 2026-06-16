import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Hammer } from "lucide-react";

// Placeholder — 重构期占位页. IA 里已可导航, 真实页面在后续前端切片接入.
export function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <div>
      <PageHeader title={title} description="此模块正在后台重构中接入。" />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="rounded-full bg-muted p-3 text-muted-foreground">
            <Hammer className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium">建设中</p>
          {note && (
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              {note}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
