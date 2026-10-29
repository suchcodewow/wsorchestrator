/**
 * The sites allowed to show the app in a frame, a page at a time, and adding
 * one. Reading takes a token; adding is session-only, as it decides which
 * sites can put the app in front of a signed-in user.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireCaller } from "@/lib/api-auth";
import { domainInputSchema } from "@/lib/allowed-domains";
import { audited, noteAudit } from "@/lib/audit";
import { addFrameDomain, FRAME_STATUS_FOR, listFrameDomains } from "@/lib/frame-domains";
import { FRAME_DOMAIN_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageSignInDomains } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageSignInDomains);
  if (error) return error;

  const { rows, page, hasMore } = await listFrameDomains(
    parseListQuery(new URL(req.url).searchParams, FRAME_DOMAIN_LIST),
  );
  return NextResponse.json({ domains: rows, page, hasMore });
}

export const POST = audited(async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageSignInDomains(session.user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = domainInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await addFrameDomain({ id: session.user.id, email: session.user.email }, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: FRAME_STATUS_FOR[result.error] });
  }
  noteAudit({ targetLabel: result.domain });
  return NextResponse.json({ ok: true });
});
