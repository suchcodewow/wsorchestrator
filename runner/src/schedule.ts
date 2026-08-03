import { claimDueScheduledRuns, log, setScheduledBack } from "./db.js";
import { triggerRunnerJob } from "./trigger.js";

/**
 * Provision every scheduled run whose start time has arrived. Each is claimed
 * atomically, then handed to its own tf-runner execution (isolated per run).
 */
export async function provisionDue(): Promise<void> {
  const due = await claimDueScheduledRuns();
  if (due.length === 0) {
    console.log("scheduler: nothing due");
    return;
  }
  console.log(`scheduler: provisioning ${due.length} due workshop(s)`);

  for (const { id } of due) {
    try {
      await log(
        id,
        "system",
        "Start time is near — the scheduler picked this up early; provisioning is starting so it's ready by the scheduled start.",
      );
      await triggerRunnerJob(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await log(id, "stderr", `could not start provisioning, will retry: ${message}`);
      await setScheduledBack(id);
    }
  }
}
