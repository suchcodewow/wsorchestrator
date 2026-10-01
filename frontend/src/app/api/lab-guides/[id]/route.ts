/** Reads, rewrites or deletes a lab guide. */

import { NextResponse } from "next/server";
import { sessionOrToken } from "@/lib/api-auth";
import {
  deleteLabGuide,
  getLabGuideById,
  getLabGuideBySlug,
  labGuideSchema,
  updateLabGuide,
  workshopsUsingGuide,
} from "@/lib/lab-guides";
import { canManageLabGuides } from "@/lib/roles";

async function requireEditor(req: Request) {
  const caller = await sessionOrToken(req);
  if (!caller) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (!canManageLabGuides(caller.access)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { error: null };
}

/**
 * By id or by slug, with its Markdown. Public, like the guide's page; an
 * editor also sees which workshops use it, unpublished ones included.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guide = (await getLabGuideById(id)) ?? (await getLabGuideBySlug(id));
  if (!guide) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const caller = await sessionOrToken(req);
  const usedIn =
    caller && canManageLabGuides(caller.access)
      ? await workshopsUsingGuide(guide.id)
      : undefined;
  return NextResponse.json({ guide, usedIn });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireEditor(req);
  if (error) return error;

  const parsed = labGuideSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { id } = await params;
  const result = await updateLabGuide(id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ guide: result.guide });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireEditor(req);
  if (error) return error;

  const { id } = await params;
  if (!(await deleteLabGuide(id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
