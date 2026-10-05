/** This account's own template sources. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { TemplatesView } from "@/components/templates-view";
import {
  checkTemplateSources,
  listTemplateSources,
} from "@/lib/harness-templates";
import { secretsConfigured } from "@/lib/secret-box";
import { canSeeMySettingsTab } from "../tabs";

export default async function MyTemplateSourcesPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canSeeMySettingsTab(session.user.access, "/me/templates")) notFound();

  const sources = await listTemplateSources(session.user.id);

  return (
    <TemplatesView
      mine
      sources={sources}
      status={await checkTemplateSources(sources)}
      configured={secretsConfigured()}
    />
  );
}
