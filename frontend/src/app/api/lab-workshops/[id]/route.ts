/** Reads, rewrites or deletes a workshop, contents and all. */

import { NextResponse } from "next/server";
import { sessionOrToken } from "@/lib/api-auth";
import {
  deleteLabWorkshop,
  getLabWorkshopById,
  getLabWorkshopBySlug,
  labWorkshopSchema,
  updateLabWorkshop,
  type LabWorkshopError,
} from "@/lib/lab-workshops";
import { canManageLabGuides } from "@/lib/roles";

const STATUS_FOR: Record<LabWorkshopError, number> = {
  not_found: 404,
  unknown_guide: 400,
};

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

/** Lab editors also see unpublished workshops; anyone else, the published ones. */
async function canEdit(req: Request): Promise<boolean> {
  const caller = await sessionOrToken(req);
  return caller !== null && canManageLabGuides(caller.access);
}

/** By id or by slug, with its guides in order. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const editor = await canEdit(req);
  const slug = (await getLabWorkshopById(id))?.slug ?? id;

  const workshop = await getLabWorkshopBySlug(slug, editor);
  if (!workshop) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ workshop });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireEditor(req);
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

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireEditor(req);
  if (error) return error;

  const { id } = await params;
  if (!(await deleteLabWorkshop(id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
