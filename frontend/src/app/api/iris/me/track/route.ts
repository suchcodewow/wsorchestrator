/** Sets the track a taker sells in, which weights their overall score. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { setTrack } from "@/lib/iris/attempts";
import { TRACKS } from "@/lib/iris/subjects";
import { canTakeIris } from "@/lib/roles";

const bodySchema = z.object({ track: z.enum(TRACKS) });

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCaller(req, canTakeIris);
  if (error) return error;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  noteAudit({ target: user.id, targetLabel: user.email ?? undefined });
  await setTrack(user.id, parsed.data.track);
  return NextResponse.json({ ok: true, track: parsed.data.track });
});
