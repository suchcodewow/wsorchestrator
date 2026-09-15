import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TF_BIN, TF_ROOT } from "./config.js";

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

/**
 * Where per-competitor working copies go. Deliberately **two path segments**
 * below `TF_ROOT` — `.work/<name>` — because every root config refers to shared
 * modules as `../../modules/...`, and a copy at any other depth would resolve
 * that to somewhere that does not exist. `scenarios/<id>` and
 * `challenges/<id>` are the same two segments deep, which is what makes a copy
 * a drop-in for its source.
 */
const WORK_DIR = ".work";

/**
 * Run `fn` against a private copy of a root config, and remove the copy after.
 *
 * Two Terraform applies cannot share a directory: they would overwrite each
 * other's `terraform.tfvars.json` and race on `.terraform`. Per-competitor
 * scenarios apply the same root many times over, concurrently, so each run gets
 * a copy of its own.
 *
 * Only the config files are copied, never `.terraform` or any state — a copy
 * initialises itself against its own backend prefix, which is what keeps one
 * competitor's state separate from another's. Provider downloads are not repeated
 * despite the fresh `.terraform`, because the image sets `TF_PLUGIN_CACHE_DIR`
 * (see runner/Dockerfile); the cache is only safe to share once populated,
 * hence `warmProviderCache` below.
 *
 * The copy is removed even when `fn` throws, so a failed apply does not leave
 * the image's Terraform tree littered. The state it wrote is in GCS and is
 * unaffected — which is what lets a retry, or the reaper, pick the same prefix
 * up again from a fresh copy.
 */
export async function withWorkDir<T>(
  source: string,
  name: string,
  fn: (workDir: string) => Promise<T>,
): Promise<T> {
  const from = path.join(TF_ROOT, source);
  const to = path.join(TF_ROOT, WORK_DIR, name);

  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });

  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    // `.tf` is the config; `scenario.json` rides along so a copy is a complete,
    // recognisable scenario if anyone ever looks at one mid-run.
    if (!entry.name.endsWith(".tf") && entry.name !== "scenario.json") continue;
    fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
  }

  try {
    return await fn(to);
  } finally {
    fs.rmSync(to, { recursive: true, force: true });
  }
}

/**
 * Populate the shared provider cache by initialising the source root once,
 * before any concurrent copies are.
 *
 * `TF_PLUGIN_CACHE_DIR` is not safe for concurrent *first* downloads — several
 * inits racing to write the same provider into it is a documented way to get a
 * corrupted cache entry, and a corrupted entry fails every later init with a
 * checksum mismatch rather than re-downloading. Reads of an already-populated
 * cache are fine, so one serial init up front makes the rest safe.
 *
 * Best-effort: a failure here is not reported, because the per-competitor init
 * that follows will hit the same problem and report it with the competitor it
 * belongs to.
 */
export async function warmProviderCache(
  source: string,
  bucket: string,
  prefix: string,
): Promise<void> {
  try {
    await tfInit(path.join(TF_ROOT, source), bucket, prefix);
  } catch {
    // Deliberately swallowed — see above.
  }
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
