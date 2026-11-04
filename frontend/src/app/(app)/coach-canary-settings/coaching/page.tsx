/** The Coaching tab: the platform context and module naming every coaching prompt carries. */

import { getCoachingSettings } from "@/lib/mimir/settings";
import { CoachingForm } from "./coaching-form";

export default async function CoachingPage() {
  const settings = await getCoachingSettings();
  return (
    <CoachingForm
      settings={{
        platformContext: settings.platformContext,
        namingGuard: settings.namingGuard,
        updatedAt: settings.updatedAt?.toISOString() ?? null,
        updatedBy: settings.updatedBy,
      }}
    />
  );
}
