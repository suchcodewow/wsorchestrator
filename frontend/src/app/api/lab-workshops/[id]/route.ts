import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  deleteLabWorkshop,
  labWorkshopSchema,
  updateLabWorkshop,
  type LabWorkshopError,
} from "@/lib/lab-workshops";
import { canManageLabGuides } from "@/lib/roles";

const STATUS_FOR: Record<LabWorkshopError, number> = {
  not_found: 404,
  // The request is well-formed but names a guide that isn't there — a stale
  // editor tab, most likely, so it is the request that is wrong, not the state.
  unknown_guide: 400,
};

/** Signed in, and allowed to write teaching material. */
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

/** Rewrite a workshop, contents and all. Managers and above. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireEditor();
  if (error) return error;

  const parsed = labWorkshopSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { id } = await params;
  const result = await updateLabWorkshop(id, parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }

  return NextResponse.json({ workshop: result.workshop });
}

/**
 * Delete a workshop. Managers and above.
 *
 * The guides survive: only the ordering rows cascade, so a lab used by three
 * workshops does not disappear because one of them was retired.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireEditor();
  if (error) return error;

  const { id } = await params;
  if (!(await deleteLabWorkshop(id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
