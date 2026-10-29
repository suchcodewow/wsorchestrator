/** Edits or removes a site allowed to show the app in a frame. */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { domainInputSchema } from "@/lib/allowed-domains";
import { audited, noteAudit } from "@/lib/audit";
import { deleteFrameDomain, FRAME_STATUS_FOR, updateFrameDomain } from "@/lib/frame-domains";
import { canManageSignInDomains } from "@/lib/roles";

async function refusal() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageSignInDomains(session.user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export const PATCH = audited(async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const refused = await refusal();
  if (refused) return refused;

  const parsed = domainInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const { id } = await params;
  noteAudit({ target: id });
  const result = await updateFrameDomain(id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: FRAME_STATUS_FOR[result.error] });
  }
  noteAudit({ targetLabel: result.domain });
  return NextResponse.json({ ok: true });
});

export const DELETE = audited(async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const refused = await refusal();
  if (refused) return refused;

  const { id } = await params;
  noteAudit({ target: id });
  const result = await deleteFrameDomain(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: FRAME_STATUS_FOR[result.error] });
  }
  noteAudit({ targetLabel: result.domain });
  return NextResponse.json({ ok: true });
});
