/** Writing and removing the tour of one kind of page, named by its path pattern. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { canEditTour } from "@/lib/nav";
import { isTourPattern } from "@/lib/tours/pattern";
import { deleteTour, saveTour, saveTourSchema } from "@/lib/tours/tours";
import type { Access } from "@/lib/roles";

/** The pattern a request names, or the response refusing it. */
function patternOf(req: Request, access: Access): { pattern: string; error: null } | { pattern: null; error: NextResponse } {
  const pattern = new URL(req.url).searchParams.get("pattern") ?? "";
  if (!isTourPattern(pattern)) {
    return { pattern: null, error: NextResponse.json({ error: "invalid_pattern" }, { status: 400 }) };
  }
  if (!canEditTour(access, pattern)) {
    return { pattern: null, error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  noteAudit({ target: pattern, targetLabel: pattern });
  return { pattern, error: null };
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;
  const named = patternOf(req, user.access);
  if (named.error) return named.error;

  const parsed = saveTourSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await saveTour(user.id, named.pattern, parsed.data);
  if (!result.ok) return NextResponse.json({ error: "conflict", version: result.version }, { status: 409 });
  noteAudit({ detail: { version: result.tour.version, steps: result.tour.steps.length } });
  return NextResponse.json({ tour: result.tour });
});

export const DELETE = audited(async function DELETE(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;
  const named = patternOf(req, user.access);
  if (named.error) return named.error;

  if (!(await deleteTour(named.pattern))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
