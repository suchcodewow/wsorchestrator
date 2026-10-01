/**
 * Everyone with an account, as the Users page lists them. Reading takes a
 * token; changing roles and inviting stay session-only.
 */

import { NextResponse } from "next/server";
import { pendingBootstrapAdmins } from "@/auth";
import { requireCaller } from "@/lib/api-auth";
import { canManageUsers } from "@/lib/roles";
import { listSiteUsers } from "@/lib/site-users";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageUsers);
  if (error) return error;

  const [users, pendingAdmins] = await Promise.all([
    listSiteUsers(),
    pendingBootstrapAdmins(),
  ]);
  return NextResponse.json({ users, pendingAdmins });
}
