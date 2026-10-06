/** Sets one of a user's roles (in an area, or platform administration), or deletes them. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { EVALS_ROLES, EVENT_ROLES, IRIS_ROLES, TRAINING_ROLES } from "@/db/schema";
import { canDeleteUsers, canManageUsers } from "@/lib/roles";
import {
  deleteUser,
  setUserRole,
  type DeleteUserError,
  type SetRoleError,
} from "@/lib/site-users";
import { audited } from "@/lib/audit";

const patchSchema = z.discriminatedUnion("area", [
  z.object({ area: z.literal("event"), role: z.enum(EVENT_ROLES) }),
  z.object({ area: z.literal("training"), role: z.enum(TRAINING_ROLES).nullable() }),
  z.object({ area: z.literal("evals"), role: z.enum(EVALS_ROLES).nullable() }),
  z.object({ area: z.literal("iris"), role: z.enum(IRIS_ROLES).nullable() }),
  z.object({ area: z.literal("platform"), value: z.boolean() }),
]);

const STATUS_FOR: Record<SetRoleError, number> = {
  not_found: 404,
  self: 409,
  forbidden: 403,
  platform_target: 403,
  bootstrap: 409,
};

export const PATCH = audited(async function PATCH(
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
});

const DELETE_STATUS_FOR: Record<DeleteUserError, number> = {
  not_found: 404,
  self: 409,
  forbidden: 403,
  bootstrap: 409,
  owns_events: 409,
};

export const DELETE = audited(async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canDeleteUsers(session.user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const result = await deleteUser(
    { id: session.user.id, access: session.user.access },
    id,
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: DELETE_STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ ok: true });
});
