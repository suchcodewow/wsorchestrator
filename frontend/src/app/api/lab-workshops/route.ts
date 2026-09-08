/** Creates a workshop and sets its contents. */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createLabWorkshop, labWorkshopSchema } from "@/lib/lab-workshops";
import { canManageLabGuides } from "@/lib/roles";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageLabGuides(session.user.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = labWorkshopSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = await createLabWorkshop(parsed.data, session.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ workshop: result.workshop }, { status: 201 });
}
