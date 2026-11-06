/** The question on screen in one of the caller's own sittings. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { openSitting, sittingModes } from "@/lib/iris/attempts";
import { canSitIris } from "@/lib/roles";

const idSchema = z.string().uuid();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireCaller(req, canSitIris);
  if (error) return error;
  const id = idSchema.safeParse((await params).id);
  const sitting = id.success ? await openSitting(user.id, id.data, sittingModes(user.access)) : null;
  if (!sitting) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ sitting });
}
