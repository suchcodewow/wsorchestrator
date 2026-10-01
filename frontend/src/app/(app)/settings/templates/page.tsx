/** The template sources page. */

import { TemplatesView } from "@/components/templates-view";
import {
  checkTemplateSources,
  listTemplateSources,
} from "@/lib/harness-templates";
import { secretsConfigured } from "@/lib/secret-box";

export default async function TemplateSourcesPage() {
  const sources = await listTemplateSources(null);

  return (
    <TemplatesView
      sources={sources}
      status={await checkTemplateSources(sources)}
      configured={secretsConfigured()}
    />
  );
}
