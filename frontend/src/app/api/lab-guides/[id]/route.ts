import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  deleteLabGuide,
  labGuideSchema,
  updateLabGuide,
} from "@/lib/lab-guides";
import { canManageLabGuides } from "@/lib/roles";

/** Signed in, and allowed to write guides. */
async function requireEditor() {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (!canManageLabGuides(session.user.siteRole)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { error: null };
}

/** Rewrite a guide. Managers and above. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireEditor();
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

/** Delete a guide outright. Managers and above. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireEditor();
  if (error) return error;

  const { id } = await params;
  if (!(await deleteLabGuide(id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
