import { harnessBaseUrl } from "@/lib/harness-platform";
import {
  checkTemplateSources,
  listTemplateSources,
} from "@/lib/harness-templates";
import { secretsConfigured } from "@/lib/secret-box";
import { TemplatesView } from "./templates-view";

/**
 * Where the site may read Harness templates from.
 *
 * Every saved source is re-checked against Harness as the page renders — one or
 * two calls per row, all in flight together. That is deliberately not cached:
 * the tick means "this works now", and a stored verdict with a date on it is a
 * different, weaker claim. Reloading the page is the re-check.
 *
 * The administrator check is the section's layout — see `settings/layout.tsx`.
 */
export default async function TemplateSourcesPage() {
  const sources = await listTemplateSources();

  return (
    <TemplatesView
      sources={sources}
      status={await checkTemplateSources(sources)}
      baseUrl={harnessBaseUrl()}
      // Whether an encryption key exists at all. Without one no token can be
      // stored, and the form says so instead of failing on save.
      configured={secretsConfigured()}
    />
  );
}
