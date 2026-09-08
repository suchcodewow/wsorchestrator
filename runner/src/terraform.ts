import { spawn } from "node:child_process";
import { TF_BIN } from "./config.js";

export type TfLine = { stream: "stdout" | "stderr"; text: string };
type OnLine = (line: TfLine) => void | Promise<void>;

/**
 * Spawn OpenTofu/Terraform in `cwd`, streaming each output line to `onLine`.
 *
 * Lines are also teed to this process's own stdout/stderr so they reach Cloud
 * Logging. `onLine` writes them to `run_logs`, which is the copy the UI shows,
 * but that lands in Postgres via the same process that is running the apply --
 * so when a run dies the only record of *why* is behind a database query. The
 * tee costs nothing and makes a failed run readable from `gcloud logging read`.
 *
 * `tee` is off for reads whose output is data rather than progress; see
 * `tfOutput`.
 */
/**
 * How many trailing stderr lines the thrown error carries.
 *
 * Enough for a Terraform diagnostic block, which is a header, a blank-trimmed
 * body and usually a file/line — not so many that a run whose every resource
 * failed writes an essay into `workshop_runs.error`.
 */
const DIAGNOSTIC_LINES = 12;

function exec(
  args: string[],
  cwd: string,
  onLine?: OnLine,
  tee = true,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(TF_BIN, args, { cwd, env: process.env });

    // The reason the exit is what it is. `exited with code 1` on its own says
    // only that something went wrong, and it was for a while the entire stored
    // error on a failed teardown: the provider's actual complaint went to
    // `onLine` and lived in run_logs, which is a table nobody queries when they
    // are looking at a run that will not tear down. Worse, it defeated
    // `isPermanentDestroyFailure` — that predicate reads the error message, and
    // the message never contained a provider signature to match.
    const diagnostics: string[] = [];

    const pump = (stream: "stdout" | "stderr") => (buf: Buffer) => {
      for (const text of buf.toString().split("\n")) {
        if (text.trim().length === 0) continue;
        // stderr stays on stderr so Cloud Run keeps tofu's diagnostics at a
        // severity that stands out from the plan chatter on stdout.
        if (tee) {
          const sink = stream === "stderr" ? process.stderr : process.stdout;
          sink.write(`${text}\n`);
        }
        if (stream === "stderr") {
          diagnostics.push(text);
          if (diagnostics.length > DIAGNOSTIC_LINES) diagnostics.shift();
        }
        void onLine?.({ stream, text });
      }
    };

    child.stdout.on("data", pump("stdout"));
    child.stderr.on("data", pump("stderr"));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const summary = `${TF_BIN} ${args[0]} exited with code ${code}`;
      reject(
        new Error(
          diagnostics.length > 0
            ? `${summary}\n${diagnostics.join("\n")}`
            : summary,
        ),
      );
    });
  });
}

export function tfInit(
  cwd: string,
  bucket: string,
  prefix: string,
  onLine?: OnLine,
) {
  return exec(
    [
      "init",
      "-input=false",
      "-no-color",
      "-reconfigure",
      `-backend-config=bucket=${bucket}`,
      `-backend-config=prefix=${prefix}`,
    ],
    cwd,
    onLine,
  );
}

export function tfApply(cwd: string, onLine?: OnLine) {
  return exec(
    ["apply", "-input=false", "-no-color", "-auto-approve", "-var-file=terraform.tfvars.json"],
    cwd,
    onLine,
  );
}

export function tfDestroy(cwd: string, onLine?: OnLine) {
  return exec(
    ["destroy", "-input=false", "-no-color", "-auto-approve", "-var-file=terraform.tfvars.json"],
    cwd,
    onLine,
  );
}

/** Read `terraform output -json` and flatten to name -> value. */
export async function tfOutput(cwd: string): Promise<Record<string, unknown>> {
  let raw = "";
  await exec(
    ["output", "-json", "-no-color"],
    cwd,
    ({ stream, text }) => {
      if (stream === "stdout") raw += text + "\n";
    },
    // Never teed: these outputs carry attendee console passwords, and stdout
    // here is the JSON payload itself, not progress worth reading in a log.
    false,
  );
  if (raw.trim().length === 0) return {};

  const parsed = JSON.parse(raw) as Record<string, { value: unknown }>;
  const flat: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(parsed)) flat[key] = entry.value;
  return flat;
}
