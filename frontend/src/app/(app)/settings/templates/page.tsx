/** The template sources page. */

import { harnessBaseUrl } from "@/lib/harness-platform";
import {
  checkTemplateSources,
  listTemplateSources,
} from "@/lib/harness-templates";
import { secretsConfigured } from "@/lib/secret-box";
import { TemplatesView } from "./templates-view";

export default async function TemplateSourcesPage() {
  const sources = await listTemplateSources();

  return (
    <TemplatesView
      sources={sources}
      status={await checkTemplateSources(sources)}
      baseUrl={harnessBaseUrl()}
      configured={secretsConfigured()}
    />
  );
}
