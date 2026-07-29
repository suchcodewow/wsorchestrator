import { spawn } from "node:child_process";
import { TF_BIN } from "./config.js";

export type TfLine = { stream: "stdout" | "stderr"; text: string };
type OnLine = (line: TfLine) => void | Promise<void>;

/** Spawn terraform in `cwd`, streaming each output line to `onLine`. */
function exec(args: string[], cwd: string, onLine?: OnLine): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(TF_BIN, args, { cwd, env: process.env });

    const pump = (stream: "stdout" | "stderr") => (buf: Buffer) => {
      for (const text of buf.toString().split("\n")) {
        if (text.trim().length > 0) void onLine?.({ stream, text });
      }
    };

    child.stdout.on("data", pump("stdout"));
    child.stderr.on("data", pump("stderr"));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`terraform ${args[0]} exited with code ${code}`)),
    );
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
  await exec(["output", "-json", "-no-color"], cwd, ({ stream, text }) => {
    if (stream === "stdout") raw += text + "\n";
  });
  if (raw.trim().length === 0) return {};

  const parsed = JSON.parse(raw) as Record<string, { value: unknown }>;
  const flat: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(parsed)) flat[key] = entry.value;
  return flat;
}
