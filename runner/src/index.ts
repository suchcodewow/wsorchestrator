import { runWorkshop } from "./run.js";
import { reap } from "./reap.js";
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
    case "reap":
      await reap();
      break;
    default:
      throw new Error(`unknown command "${command}" (expected "run" or "reap")`);
  }
}

main()
  .then(() => endPool())
  .catch(async (err) => {
    console.error(err);
    await endPool().catch(() => {});
    process.exit(1);
  });
