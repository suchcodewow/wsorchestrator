/** Takes up an invite link as the signed-in user. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { homePath, type Access } from "@/lib/roles";
import { acceptInvite, type InviteError } from "@/lib/user-invites";

const postSchema = z.object({ token: z.string().min(1).max(200) });

const STATUS_FOR: Record<InviteError, number> = {
  not_found: 404,
  expired: 410,
  revoked: 410,
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = await acceptInvite(session.user.id, parsed.data.token);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }

  const access: Access = result.applied
    ? {
        event: result.grant.eventRole ?? "none",
        scheduler: result.grant.schedulerRole,
        platform: false,
      }
    : session.user.access;
  return NextResponse.json({ applied: result.applied, home: homePath(access) });
}
