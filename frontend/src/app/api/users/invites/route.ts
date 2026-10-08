/** Creates an invite link for the roles the caller administers. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { ASSESSMENTS_ROLES, EVENT_ROLES, TRAINING_ROLES } from "@/db/schema";
import { canManageUsers } from "@/lib/roles";
import { createInvite, type CreateInviteError } from "@/lib/user-invites";
import { audited } from "@/lib/audit";

const postSchema = z.object({
  eventRole: z.enum(EVENT_ROLES).nullable(),
  trainingRole: z.enum(TRAINING_ROLES).nullable(),
  // Optional, so a caller written before eVals existed still works.
  assessmentsRole: z.enum(ASSESSMENTS_ROLES).nullable().default(null),
});

const STATUS_FOR: Record<CreateInviteError, number> = {
  empty: 400,
  forbidden: 403,
};

export const POST = audited(async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageUsers(session.user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { eventRole, trainingRole, assessmentsRole } = parsed.data;
  const result = await createInvite(
    { id: session.user.id, access: session.user.access },
    { eventRole: eventRole === "none" ? null : eventRole, trainingRole, assessmentsRole },
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json(
    { path: `/invite/${result.token}`, expiresAt: result.expiresAt.toISOString() },
    { status: 201 },
  );
});
