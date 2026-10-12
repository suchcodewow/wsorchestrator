/**
 * Every job Cloud Scheduler runs, for the Timed Jobs tab. Pure, so the page,
 * the API reference and the unit test can all read it; the schedule text
 * repeats `infra/admin/scheduler.tf`, and `test/unit/timed-jobs.test.ts`
 * fails when the two disagree.
 */

export type TimedJobDef = {
  key: string;
  name: string;
  /** What the job does, in a sentence. */
  summary: string;
  /** The cron expression exactly as scheduler.tf has it. */
  cron: string;
  /** IANA zone the cron is read in. */
  timeZone: string;
  /** The schedule in words. */
  schedule: string;
  /** The Terraform resource that runs it. */
  resource: string;
  /** What switching it off costs, shown beside the switch while it is off. */
  offWarning?: string;
};

export const TIMED_JOBS: readonly TimedJobDef[] = [
  {
    key: "reaper",
    name: "Reaper",
    summary: "Destroys expired workshop runs and rewrites deployed secrets.",
    cron: "*/5 * * * *",
    timeZone: "UTC",
    schedule: "Every 5 minutes",
    resource: "tf-reaper-trigger",
    offWarning: "Expired workshops are not torn down while this is off, and keep costing money.",
  },
  {
    key: "scheduler",
    name: "Workshop scheduler",
    summary: "Starts provisioning for workshops whose start time is near.",
    cron: "*/5 * * * *",
    timeZone: "UTC",
    schedule: "Every 5 minutes",
    resource: "tf-scheduler-trigger",
    offWarning: "Scheduled workshops are not started while this is off, so they are not ready on time.",
  },
  {
    key: "hibob-sync",
    name: "HiBob sync",
    summary: "Syncs employees from HiBob, then the cohort Slack channels.",
    cron: "0 3 * * *",
    timeZone: "America/New_York",
    schedule: "Daily at 3:00 AM Eastern",
    resource: "hibob-sync-trigger",
  },
  {
    key: "intake-reminders",
    name: "Intake reminders",
    summary: "Sends the daily Slack reminder to anyone yet to answer their intake form.",
    cron: "0 10 * * *",
    timeZone: "America/New_York",
    schedule: "Daily at 10:00 AM Eastern",
    resource: "intake-reminders-trigger",
  },
  {
    key: "canary-wire-pull",
    name: "Canary Wire pull",
    summary: "Pulls completions from Mindtickle, a step at a time.",
    cron: "0,5,10,15,20,25,30 */2 * * *",
    timeZone: "America/New_York",
    schedule: "Every 5 minutes for the first half hour of every second hour, Eastern",
    resource: "canary-wire-pull-trigger",
  },
];

export function timedJobDef(key: string): TimedJobDef | undefined {
  return TIMED_JOBS.find((job) => job.key === key);
}
