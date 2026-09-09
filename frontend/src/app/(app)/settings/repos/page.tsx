/** The GitHub repositories page. */

import { listRepos } from "@/lib/harness-repos";
import { ReposView } from "./repos-view";

export default async function ReposPage() {
  return <ReposView repos={await listRepos()} />;
}
