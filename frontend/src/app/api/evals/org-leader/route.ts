/** Sets the Organization Leader whose reports eVals draws attendees from. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { setOrgLeaderEmail } from "@/lib/evals/settings";
import { audited } from "@/lib/audit";

const bodySchema = z.object({ email: z.string().email() });

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await setOrgLeaderEmail(user.id, parsed.data.email);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});
