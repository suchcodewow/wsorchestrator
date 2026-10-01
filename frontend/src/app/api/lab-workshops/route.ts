/** The workshops, and creating one. Reading is public, like /labs. */

import { NextResponse } from "next/server";
import { sessionOrToken } from "@/lib/api-auth";
import {
  createLabWorkshop,
  labWorkshopSchema,
  listLabWorkshops,
} from "@/lib/lab-workshops";
import { canManageLabGuides } from "@/lib/roles";

/** Lab editors also see unpublished workshops; anyone else, the published ones. */
async function canEdit(req: Request): Promise<boolean> {
  const caller = await sessionOrToken(req);
  return caller !== null && canManageLabGuides(caller.access);
}

export async function GET(req: Request) {
  return NextResponse.json({ workshops: await listLabWorkshops(await canEdit(req)) });
}

export async function POST(req: Request) {
  const caller = await sessionOrToken(req);
  if (!caller) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageLabGuides(caller.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = labWorkshopSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = await createLabWorkshop(parsed.data, caller.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ workshop: result.workshop }, { status: 201 });
}
