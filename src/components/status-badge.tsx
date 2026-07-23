import { Badge } from "@/components/ui/badge";
import type { RunStatus } from "@/db/schema";
import { cn } from "@/lib/utils";

const LABELS: Record<RunStatus, string> = {
  requested: "Requested",
  provisioning: "Provisioning",
  applying: "Applying",
  ready: "Ready",
  destroying: "Destroying",
  destroyed: "Destroyed",
  failed: "Failed",
};

const STYLES: Record<RunStatus, string> = {
  requested: "bg-slate-100 text-slate-700",
  provisioning: "bg-blue-100 text-blue-700",
  applying: "bg-amber-100 text-amber-800",
  ready: "bg-emerald-100 text-emerald-700",
  destroying: "bg-orange-100 text-orange-700",
  destroyed: "bg-slate-100 text-slate-500",
  failed: "bg-red-100 text-red-700",
};

const ACTIVE: RunStatus[] = ["requested", "provisioning", "applying", "destroying"];

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", STYLES[status])}>
      {ACTIVE.includes(status) && (
        <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {LABELS[status]}
    </Badge>
  );
}
