/** Offers a tested component set for review. */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessionOrToken } from "@/lib/api-auth";
import { harnessComponentSets, workshopRuns } from "@/db/schema";
import { canContributeComponents } from "@/lib/roles";
import { setStatus } from "@/lib/components/catalog";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await sessionOrToken(req);
  if (!viewer) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canContributeComponents(viewer.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const [set] = await db
    .select()
    .from(harnessComponentSets)
    .where(eq(harnessComponentSets.id, id));

  if (!set || set.authorId !== viewer.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { notes?: unknown };
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : "";

  const moved = await setStatus(id, "testing", "submitted", notes);
  if (!moved) {
    return NextResponse.json(
      {
        error: "not_submittable",
        message: `only a set still being tested can be submitted (this one is ${set.status})`,
      },
      { status: 409 },
    );
  }

  const runs = await db
    .select({ id: workshopRuns.id, status: workshopRuns.status })
    .from(workshopRuns)
    .where(eq(workshopRuns.componentSetId, id));

  return NextResponse.json({
    setId: id,
    status: "submitted",
    testedBy: runs,
    untested: runs.length === 0,
  });
}
