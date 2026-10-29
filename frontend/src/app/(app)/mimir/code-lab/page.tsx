/**
 * The Code Lab: practise changing code, committing it and opening a pull
 * request, on a made-up shop's home page. It is all pretend and all in the
 * browser, so there is nothing to fetch or keep.
 */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { WideView } from "@/components/wide-view";
import { CodeLabView } from "./code-lab-view";

export default async function CodeLabPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  return (
    <WideView>
      <CodeLabView author={session.user.name?.split(" ")[0] || "You"} />
    </WideView>
  );
}
