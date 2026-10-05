/**
 * Replaces the Canary Wire's data with a pull uploaded as a file: the
 * `output/snapshot.json` canary-wire-reports writes. Until the app pulls from
 * Mindtickle itself, this is how its data arrives.
 */

import { NextResponse } from "next/server";
import { CANARY_WIRE_LIMITS } from "@/db/schema";
import { requireCanaryWire } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { parseSnapshot } from "@/lib/canary-wire/snapshot";
import { saveSnapshot } from "@/lib/canary-wire/store";
import { toPacific } from "@/lib/canary-wire/months";

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCanaryWire(req);
  if (error) return error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  if (file.size > CANARY_WIRE_LIMITS.bytes) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const parsed = parseSnapshot(await file.text());
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, detail: parsed.detail }, { status: 400 });
  }

  const { id } = await saveSnapshot(parsed.snapshot, user.id);
  const fetchedAt = toPacific(new Date(parsed.snapshot.fetched_at).toISOString());
  noteAudit({ target: id, targetLabel: `Mindtickle pull of ${fetchedAt}`, detail: { learners: parsed.snapshot.learners.length } });
  return NextResponse.json({
    id,
    fetchedAt: new Date(parsed.snapshot.fetched_at).toISOString(),
    learners: parsed.snapshot.learners.length,
    modules: parsed.snapshot.modules.length,
  });
});
