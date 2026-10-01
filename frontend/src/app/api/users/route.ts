/**
 * Everyone with an account, as the Users page lists them, a page at a time.
 * Reading takes a token; changing roles and inviting stay session-only.
 */

import { NextResponse } from "next/server";
import { pendingBootstrapAdmins } from "@/auth";
import { requireCaller } from "@/lib/api-auth";
import { parseListQuery } from "@/lib/paging";
import { canManageUsers } from "@/lib/roles";
import { USER_LIST } from "@/lib/list-specs";
import { listSiteUsers } from "@/lib/site-users";

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
