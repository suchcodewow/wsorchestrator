/** What the deploy picker offers: the site's content, and one user's own. */

import "server-only";
import { listOrgSecrets } from "@/lib/harness-org-secrets";
import {
  listTemplateSources,
  type TemplateSourceRow,
} from "@/lib/harness-templates";

export type DeployChoices = {
  /** How much the site holds of its own, which is one tick together. */
  official: { secrets: number; sources: number };
  /** How many org secrets this user keeps of their own. */
  mySecrets: number;
  /** This user's own template sources, one tick each. */
  myTemplates: TemplateSourceRow[];
};

export async function deployChoices(userId: string): Promise<DeployChoices> {
  const [secrets, sources, mySecrets, myTemplates] = await Promise.all([
    listOrgSecrets(null),
    listTemplateSources(null),
    listOrgSecrets(userId),
    listTemplateSources(userId),
  ]);

  return {
    official: { secrets: secrets.length, sources: sources.length },
    mySecrets: mySecrets.length,
    myTemplates,
  };
}
