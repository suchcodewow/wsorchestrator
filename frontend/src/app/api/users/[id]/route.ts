/** Sets one of a user's roles: in an area, or platform administration. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { EVENT_ROLES, SCHEDULER_ROLES } from "@/db/schema";
import { canManageUsers } from "@/lib/roles";
import { setUserRole, type SetRoleError } from "@/lib/site-users";

const patchSchema = z.discriminatedUnion("area", [
  z.object({ area: z.literal("event"), role: z.enum(EVENT_ROLES) }),
  z.object({ area: z.literal("scheduler"), role: z.enum(SCHEDULER_ROLES).nullable() }),
  z.object({ area: z.literal("platform"), value: z.boolean() }),
]);

const STATUS_FOR: Record<SetRoleError, number> = {
  not_found: 404,
  self: 409,
  forbidden: 403,
  platform_target: 403,
  bootstrap: 409,
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageUsers(session.user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { id } = await params;
  const result = await setUserRole(
    { id: session.user.id, access: session.user.access },
    id,
    parsed.data,
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ ok: true, ...parsed.data });
}
