/**
 * Every timed job, for the Timed Jobs tab. Pure, so the page, the API
 * reference and the unit test can all read it.
 *
 * Two kinds. The Cloud Run jobs (reaper, scheduler) have a Cloud Scheduler
 * job each, so their schedule is the one in `infra/admin/scheduler.tf` and
 * `test/unit/timed-jobs.test.ts` fails when the two disagree. The app's own
 * jobs are started by its dispatcher (`lib/timed-jobs.ts`), which Cloud
 * Scheduler's `timed-jobs-tick` calls every five minutes; their schedule here
 * is only the default, which an administrator can change on the tab.
 */

export type TimedJobDef = {
  key: string;
  name: string;
  /** What the job does, in a sentence. */
  summary: string;
  /**
   * `dispatcher` for the app's own jobs, whose schedule is kept in the
   * database and can be changed; `cloud-scheduler` for one Terraform fixes.
   */
  via: "dispatcher" | "cloud-scheduler";
  /** The cron expression: scheduler.tf's exactly, or the dispatcher's default. */
  cron: string;
  /** IANA zone the cron is read in. */
  timeZone: string;
  /** The default schedule in words. */
  schedule: string;
  /** The Cloud Scheduler job that calls it, or the dispatcher's tick. */
  resource: string;
  /** What switching it off costs, shown beside the switch while it is off. */
  offWarning?: string;
};

/** The Cloud Scheduler job that calls the dispatcher. */
export const TICK_RESOURCE = "timed-jobs-tick";

export const TIMED_JOBS: readonly TimedJobDef[] = [
  {
    key: "reaper",
    name: "Reaper",
    summary: "Destroys expired workshop runs and rewrites deployed secrets.",
    cron: "*/5 * * * *",
    timeZone: "UTC",
    schedule: "Every 5 minutes",
    via: "cloud-scheduler",
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
    via: "cloud-scheduler",
    resource: "tf-scheduler-trigger",
    offWarning: "Scheduled workshops are not started while this is off, so they are not ready on time.",
  },
  {
    key: "hibob-sync",
    name: "HiBob sync",
    summary: "Syncs employees from HiBob, then the cohort Slack channels, then sends the day's intake form reminders.",
    cron: "0 3 * * *",
    timeZone: "America/New_York",
    schedule: "Daily at 3:00 AM Eastern",
    via: "dispatcher",
    resource: TICK_RESOURCE,
  },
  {
    key: "google-meetings-sync",
    name: "Google Meetings sync",
    summary: "Reads the Revenue Enablement calendar and Zoom attendance, then invites the cohort to its meetings.",
    cron: "0 4 * * *",
    timeZone: "America/New_York",
    schedule: "Daily at 4:00 AM Eastern",
    via: "dispatcher",
    resource: TICK_RESOURCE,
  },
  {
    key: "canary-wire-pull",
    name: "Canary Wire pull",
    summary: "Pulls completions from Mindtickle, a step at a time: a pull takes three or four runs five minutes apart, so a schedule needs a burst like the default's.",
    cron: "0,5,10,15,20,25,30 */2 * * *",
    timeZone: "America/New_York",
    schedule: "Every 5 minutes for the first half hour of every second hour, Eastern",
    via: "dispatcher",
    resource: TICK_RESOURCE,
  },
];

export function timedJobDef(key: string): TimedJobDef | undefined {
  return TIMED_JOBS.find((job) => job.key === key);
}
