/** Saves your one-line takeaway on a Mimir item, once the coach has said you are ready. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { reflectionSchema, setReflection } from "@/lib/mimir/progress";

const STATUS = { not_found: 404, not_ready: 409 } as const;

export const PUT = audited(async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const parsed = reflectionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await setReflection(user.id, (await params).id, parsed.data.reflection);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] });
  return NextResponse.json({ ok: true, tier: result.tier });
});
