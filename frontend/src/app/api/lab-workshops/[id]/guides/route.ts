/** Appends one guide to a workshop's contents. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  appendGuideToWorkshop,
  type AppendGuideError,
} from "@/lib/lab-workshops";
import { canManageLabGuides } from "@/lib/roles";

const appendSchema = z.object({ guideId: z.string().uuid() });

const STATUS_FOR: Record<AppendGuideError, number> = {
  not_found: 404,
  unknown_guide: 400,
  full: 409,
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageLabGuides(session.user.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = appendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { id } = await params;
  const result = await appendGuideToWorkshop(id, parsed.data.guideId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }

  return NextResponse.json({ ok: true, slug: result.workshop.slug });
}
