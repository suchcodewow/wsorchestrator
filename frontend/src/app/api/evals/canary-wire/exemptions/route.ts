/**
 * The Canary Wire exemptions set by hand, which override bootcamp history for
 * one person. Read as rows and as the text the dialog edits; saved as text.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { CANARY_WIRE_LIMITS } from "@/db/schema";
import { requireCanaryWire } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { formatExemptionText, parseExemptionText } from "@/lib/canary-wire/exemptions";
import { listExemptions, replaceExemptions } from "@/lib/canary-wire/store";

async function current() {
  const rows = await listExemptions();
  return {
    exemptions: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
    text: formatExemptionText(rows),
  };
}

export async function GET(req: Request) {
  const { error } = await requireCanaryWire(req);
  if (error) return error;
  return NextResponse.json(await current());
}

const body = z.object({ text: z.string().max(CANARY_WIRE_LIMITS.exemptionText) });

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCanaryWire(req);
  if (error) return error;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const rows = parseExemptionText(parsed.data.text);
  if (rows.length > CANARY_WIRE_LIMITS.exemptions) {
    return NextResponse.json({ error: "too_many" }, { status: 400 });
  }

  const counts = await replaceExemptions(rows, user.id);
  noteAudit({ targetLabel: `Canary Wire exemptions (${rows.length})`, detail: counts });
  return NextResponse.json({ ...(await current()), ...counts });
});
