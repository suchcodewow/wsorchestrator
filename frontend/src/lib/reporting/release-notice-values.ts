/**
 * The Slack message a release sends to the managers of a class and the
 * Additional Slack Contacts, and who they are. Pure, so the unit suite
 * covers them; `release-notice.ts` sends it.
 */

import { STAGE_LABELS } from "@/lib/evals/assessment-values";
import { BOOTCAMP_COHORT_PREFIX } from "@/lib/list-specs";
import type { ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { surveyMonth } from "@/lib/surveys/survey-values";

/**
 * "Feedback has been released for November 2026 Bootcamp!  Click here …", with
 * "Click here" linking to `url` with Current cohort filtered to the class released.
 */
export function releaseNoticeText(stage: ReleaseStage, startDate: string, url: string): string {
  const link = `${url}?${BOOTCAMP_COHORT_PREFIX}.stage=${stage}`;
  return `Feedback has been released for ${surveyMonth(startDate)} ${STAGE_LABELS[stage]}!  <${link}|Click here> to view results for your attendees`;
}

/**
 * Everyone in the management chain of anyone in `chains`, each a
 * `management_chain` as the HiBob sync stores it: lowercased emails from the
 * manager up to the Organization Leader, joined with `;`. Then the
 * Additional Slack Contacts, `contacts`, whoever they manage. Each email
 * once, in the order first met; an attendee who manages another attendee is
 * in it too.
 */
export function releaseNoticeRecipients(chains: readonly (string | null)[], contacts: readonly string[] = []): string[] {
  const seen = new Set<string>();
  for (const email of [...chains.flatMap((chain) => (chain ?? "").split(";")), ...contacts]) {
    const e = email.trim().toLowerCase();
    if (e) seen.add(e);
  }
  return [...seen];
}
