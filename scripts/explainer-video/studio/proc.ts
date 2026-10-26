/**
 * Running a command without blocking: a render takes many minutes, and the
 * job's heartbeat has to keep ticking while it does.
 */

import { spawn } from "node:child_process";

export type ProcResult = { code: number | null; output: string };

/** The tail of what a command printed is what says why it failed. */
const KEEP = 40_000;

export function run(
  command: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const take = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > KEEP * 2) output = output.slice(-KEEP);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          output += `\n(stopped after ${Math.round(opts.timeoutMs! / 1000)}s)`;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, output: output.slice(-KEEP) });
    });
  });
}

/** Runs a command that must succeed, and returns what it printed. */
export async function must(command: string, args: string[], opts: Parameters<typeof run>[2]): Promise<string> {
  const r = await run(command, args, opts);
  if (r.code !== 0) throw new Error(`${command} ${args[0] ?? ""} failed (${r.code}): ${r.output.slice(-2000)}`);
  return r.output;
}
