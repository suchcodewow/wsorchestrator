/** The published components every workshop gets, with what each depends on and is used by. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { listBaseline } from "@/lib/components/catalog";
import { referenceMap } from "@/lib/components/graph";
import { canUseEvents } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseEvents);
  if (error) return error;

  const baseline = await listBaseline();
  const { dependsOn, usedBy } = referenceMap(baseline);

  return NextResponse.json({
    components: baseline.map((c) => ({
      ...c,
      dependsOn: dependsOn.get(c.identifier) ?? [],
      usedBy: usedBy.get(c.identifier) ?? [],
    })),
  });
}
