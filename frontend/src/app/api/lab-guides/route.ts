import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createLabGuide, labGuideSchema } from "@/lib/lab-guides";
import { canManageLabGuides } from "@/lib/roles";

/** Write a new lab guide. Managers and above. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Not 401: they are signed in, they just aren't allowed to write guides.
  if (!canManageLabGuides(session.user.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = labGuideSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const guide = await createLabGuide(parsed.data, session.user.id);
  return NextResponse.json({ guide }, { status: 201 });
}
