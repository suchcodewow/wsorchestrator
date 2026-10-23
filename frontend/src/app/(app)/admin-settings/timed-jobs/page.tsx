/** The timed jobs: their schedules, last runs and switches. */

import { listTimedJobs } from "@/lib/timed-jobs";
import { TimedJobsView } from "./timed-jobs-view";

export default async function TimedJobsPage() {
  return <TimedJobsView jobs={await listTimedJobs()} />;
}
