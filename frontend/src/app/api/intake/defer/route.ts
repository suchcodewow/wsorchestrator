/**
 * Defers the signed-in caller from Pre-Bootcamp to the next bootcamp: their
 * track becomes Deferred, which takes them off the Current tab and out of the
 * form. It is the "Defer" button on /intake/registration, after they confirm.
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { deferMyIntake } from "@/lib/logistics/intake";
import { isIntakeFormId } from "@/lib/logistics/intake-values";

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;
  if (!user.email) return NextResponse.json({ error: "not_in_cohort" }, { status: 404 });

  const want = new URL(req.url).searchParams.get("form");
  const result = await deferMyIntake(user.id, user.email, isIntakeFormId(want) ? want : null);
  if (!result.ok) {
    return result.error === "not_in_cohort"
      ? NextResponse.json({ error: "not_in_cohort" }, { status: 404 })
      : NextResponse.json({ error: "not_bootcamp" }, { status: 409 });
  }
  if (result.test) noteAudit({ target: user.email, targetLabel: `Pre-Bootcamp defer (test): ${user.email}` });
  return NextResponse.json({ deferred: !result.test });
});
