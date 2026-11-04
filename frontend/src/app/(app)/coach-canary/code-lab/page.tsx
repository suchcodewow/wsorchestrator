/**
 * Mimir's hands-on experiences: the list of them, each opening in a window of
 * its own. The first is the Code Lab, practising a code change from branch to
 * merge on a made-up shop's home page. It is all pretend and all in the
 * browser, so there is nothing to fetch or keep.
 */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { ExperiencesView } from "./experiences";

export default async function HandsOnExperiencesPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  return <ExperiencesView author={session.user.name?.split(" ")[0] || "You"} />;
}
