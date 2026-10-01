import { runWorkshop } from "./run.js";
import { reap } from "./reap.js";
import { provisionDue } from "./schedule.js";
import { scrubDeployedSecrets } from "./scrub.js";
import { importProduction } from "./import-production.js";
import { endPool } from "./db.js";

async function main() {
  const command = process.argv[2] ?? process.env.RUNNER_COMMAND;

  switch (command) {
    case "run": {
      const runId = process.env.RUN_ID;
      if (!runId) throw new Error("RUN_ID env var is required for `run`");
      await runWorkshop(runId);
      break;
    }
    // Two duties on one trigger. Both are "take back what has outlived its
    // welcome", both want to run every few minutes, and the reaper's schedule
    // already exists — a second Cloud Scheduler job and Cloud Run job to
    // overwrite a handful of secrets would be infrastructure to maintain for no
    // difference in behaviour. Runs after the teardowns, and separately, so a
    // Harness account that will not answer cannot cost a workshop its teardown.
    case "reap":
      await reap();
      await scrubDeployedSecrets();
      break;
    case "provision-due":
      await provisionDue();
      break;
    // QA only, and it refuses anywhere else. Started from QA's Backups page as
    // a tf-runner execution with this as its args.
    case "import-production":
      await importProduction();
      break;
    default:
      throw new Error(
        `unknown command "${command}" (expected "run", "reap", "provision-due", or "import-production")`,
      );
  }
}

main()
  .then(() => endPool())
  .catch(async (err) => {
    console.error(err);
    await endPool().catch(() => {});
    process.exit(1);
  });
