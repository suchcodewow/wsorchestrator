/**
 * Everyone with an account, as the Users page lists them, a page at a time,
 * and adding an employee as one. Reading takes a token; adding, changing
 * roles and inviting stay session-only.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, pendingBootstrapAdmins } from "@/auth";
import { ASSESSMENTS_ROLES, EVENT_ROLES, TRAINING_ROLES } from "@/db/schema";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { parseListQuery } from "@/lib/paging";
import { canAddUsers, canManageUsers } from "@/lib/roles";
import { USER_LIST } from "@/lib/list-specs";
import { addUser, listSiteUsers, type AddUserError } from "@/lib/site-users";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageUsers);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, USER_LIST);
  const [{ rows, page, hasMore }, pendingAdmins] = await Promise.all([
    listSiteUsers(query),
    pendingBootstrapAdmins(),
  ]);
  return NextResponse.json({ users: rows, page, hasMore, pendingAdmins });
}

const postSchema = z.object({
  email: z.string().trim().min(1).max(320),
  eventRole: z.enum(EVENT_ROLES).default("none"),
  trainingRole: z.enum(TRAINING_ROLES).nullable().default(null),
  assessmentsRole: z.enum(ASSESSMENTS_ROLES).nullable().default(null),
  isPlatformAdmin: z.boolean().default(false),
});

const STATUS_FOR: Record<AddUserError, number> = {
  forbidden: 403,
  not_employee: 404,
  exists: 409,
};

export const POST = audited(async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canAddUsers(session.user.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const { email, ...roles } = parsed.data;
  const result = await addUser(session.user, email, roles);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS_FOR[result.error] });
  return NextResponse.json({ user: result.user }, { status: 201 });
});
