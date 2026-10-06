/** Sends /iris to the tests. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canTakeIris } from "@/lib/roles";

export default async function IrisPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canTakeIris(session.user.access)) notFound();

  redirect("/iris/tests");
}
