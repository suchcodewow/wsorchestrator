/** The page for an area that exists in the navigation but not yet in code. */

import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function ComingSoon({
  title,
  description,
  Icon,
}: {
  title: string;
  description: string;
  Icon: LucideIcon;
}) {
  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-medium tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Icon className="size-8 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">Nothing here yet.</p>
        </CardContent>
      </Card>
    </div>
  );
}
