/** Where a take, or one of its streams, stands, as a badge. */

import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RecordingTrackStatus } from "@/db/schema";
import { cn } from "@/lib/utils";

const LABEL: Record<RecordingTrackStatus, string> = {
  uploading: "Uploading",
  assembling: "Finishing",
  ready: "Ready",
  failed: "Failed",
};

export function TakeStatus({ status, stalled }: { status: RecordingTrackStatus; stalled: boolean }) {
  return (
    <Badge
      variant={status === "ready" ? "default" : "outline"}
      className={cn(
        status === "failed" && "border-destructive text-destructive",
        stalled && "border-amber-600/50 text-amber-600 dark:text-amber-500",
      )}
    >
      {!stalled && (status === "uploading" || status === "assembling") && <Loader2 className="size-3 animate-spin" />}
      {stalled ? "Stalled" : LABEL[status]}
    </Badge>
  );
}
