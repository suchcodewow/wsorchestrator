/**
 * The Slack message a release sends to the managers of a class, and who
 * they are. Pure, so the unit suite covers them; `release-notice.ts` sends it.
 */

import { STAGE_LABELS } from "@/lib/evals/assessment-values";
import type { ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { surveyMonth } from "@/lib/surveys/survey-values";

/** "Feedback has been released for November 2026 Bootcamp!  Click here …", with "Click here" linking to `url`. */
export function releaseNoticeText(stage: ReleaseStage, startDate: string, url: string): string {
  return `Feedback has been released for ${surveyMonth(startDate)} ${STAGE_LABELS[stage]}!  <${url}|Click here> to view results for your attendees`;
}

/**
 * Everyone in the management chain of anyone in `chains`, each a
 * `management_chain` as the HiBob sync stores it: lowercased emails from the
 * manager up to the Organization Leader, joined with `;`. Each email once, in
 * the order first met; an attendee who manages another attendee is in it too.
 */
export function releaseNoticeRecipients(chains: readonly (string | null)[]): string[] {
  const seen = new Set<string>();
  for (const chain of chains) {
    for (const email of (chain ?? "").split(";")) {
      const e = email.trim().toLowerCase();
      if (e) seen.add(e);
    }
  }
  return [...seen];
}
