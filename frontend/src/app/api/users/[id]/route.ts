import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { SITE_ROLES } from "@/db/schema";
import { canManageUsers } from "@/lib/roles";
import { setSiteRole, type SetSiteRoleError } from "@/lib/site-users";

const patchSchema = z.object({ role: z.enum(SITE_ROLES) });

const STATUS_FOR: Record<SetSiteRoleError, number> = {
  not_found: 404,
  self: 409,
};

/** Set a user's site role. Administrators only. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Not 401: they are signed in, they just aren't allowed here.
  if (!canManageUsers(session.user.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { id } = await params;
  const result = await setSiteRole(session.user.id, id, parsed.data.role);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ ok: true, role: parsed.data.role });
}
