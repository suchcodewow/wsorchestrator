/** The lab guides, and writing a new one. Reading is public, like /labs/guides. */

import { NextResponse } from "next/server";
import { sessionOrToken } from "@/lib/api-auth";
import { createLabGuide, labGuideSchema, listLabGuides } from "@/lib/lab-guides";
import { canManageLabGuides } from "@/lib/roles";

export async function GET() {
  return NextResponse.json({ guides: await listLabGuides() });
}

export async function POST(req: Request) {
  const caller = await sessionOrToken(req);
  if (!caller) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageLabGuides(caller.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = labGuideSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const guide = await createLabGuide(parsed.data, caller.id);
  return NextResponse.json({ guide }, { status: 201 });
}
