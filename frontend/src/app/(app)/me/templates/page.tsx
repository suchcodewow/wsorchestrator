/** This account's own template sources. */

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { TemplatesView } from "@/components/templates-view";
import { harnessBaseUrl } from "@/lib/harness-platform";
import {
  checkTemplateSources,
  listTemplateSources,
} from "@/lib/harness-templates";
import { secretsConfigured } from "@/lib/secret-box";

export default async function MyTemplateSourcesPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const sources = await listTemplateSources(session.user.id);

  return (
    <TemplatesView
      mine
      sources={sources}
      status={await checkTemplateSources(sources)}
      baseUrl={harnessBaseUrl()}
      configured={secretsConfigured()}
    />
  );
}
