/** The users page. */

import { notFound, redirect } from "next/navigation";
import { auth, pendingBootstrapAdmins } from "@/auth";
import { canManageUsers } from "@/lib/roles";
import { listSiteUsers } from "@/lib/site-users";
import { UsersTable } from "./users-table";

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (!canManageUsers(session.user.siteRole)) notFound();

  const [users, pendingAdmins] = await Promise.all([
    listSiteUsers(),
    pendingBootstrapAdmins(),
  ]);

  return (
    <UsersTable
      users={users}
      viewerId={session.user.id}
      pendingAdmins={pendingAdmins}
    />
  );
}
