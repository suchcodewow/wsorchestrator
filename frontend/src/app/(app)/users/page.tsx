/** The users page. */

import { notFound, redirect } from "next/navigation";
import { auth, pendingBootstrapAdmins, signInPath } from "@/auth";
import { parseListQuery } from "@/lib/paging";
import { canManageUsers } from "@/lib/roles";
import { USER_LIST } from "@/lib/list-specs";
import { listSiteUsers } from "@/lib/site-users";
import { UsersTable } from "./users-table";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageUsers(session.user.access)) notFound();

  const query = parseListQuery(await searchParams, USER_LIST);
  const [page, pendingAdmins] = await Promise.all([
    listSiteUsers(query),
    pendingBootstrapAdmins(),
  ]);

  return (
    <UsersTable
      query={query}
      page={page}
      viewerId={session.user.id}
      viewerAccess={session.user.access}
      pendingAdmins={pendingAdmins}
    />
  );
}
