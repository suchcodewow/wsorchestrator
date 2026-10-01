/**
 * Starts the production build for the e2e suite, or uses one already running.
 *
 * The server gets a deliberately bare environment rather than this shell's:
 * the scratch database, a throwaway AUTH_SECRET, and no cloud or Harness
 * credentials at all. HOME points at an empty directory so the Google client
 * libraries cannot find a developer's gcloud login either. A page that would
 * reach out to a cloud therefore finds nothing configured, which is what makes
 * it safe to sign in as a platform administrator and open every page.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, openSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);

/** SITE_ADMIN_EMAILS the server is started with; the suite seeds these users. */
export const E2E_BOOTSTRAP_EMAILS = ["e2e_bootstrap@roles.test", "e2e_pending@roles.test"];

export type Server = { baseUrl: string; logFile: string | null; stop: () => Promise<void> };

const FRONTEND = path.resolve(import.meta.dirname, "../..");

function standaloneServer(): string {
  // `output: "standalone"` nests the server under the tracing root's layout.
  for (const candidate of [
    ".next/standalone/server.js",
    ".next/standalone/frontend/server.js",
  ]) {
    const full = path.join(FRONTEND, candidate);
    if (existsSync(full)) return full;
  }
  throw new Error("no production build found: run `npm run build` first");
}

export async function startServer(databaseUrl: string): Promise<Server> {
  if (process.env.E2E_BASE_URL) {
    // Someone else's server: trusted to have been started with the same
    // SITE_ADMIN_EMAILS and database, which the suite checks as it goes.
    return { baseUrl: process.env.E2E_BASE_URL, logFile: null, stop: async () => {} };
  }

  const baseUrl = `http://127.0.0.1:${E2E_PORT}`;
  if (await responds(baseUrl)) {
    throw new Error(
      `something is already listening on ${baseUrl}. It is not this suite's to stop — ` +
        "set E2E_PORT to a free port, or E2E_BASE_URL to use it deliberately.",
    );
  }

  const home = mkdtempSync(path.join(tmpdir(), "wo-e2e-home-"));
  const logFile = path.join(home, "server.log");
  const log = openSync(logFile, "a");
  const server = standaloneServer();

  // `next build` copies frontend/.env into the standalone directory, and the
  // server loads it for every variable not set below, so a developer's real
  // credentials (or .env.example's placeholders) would reach the server under
  // test. The deployed image never has one: .dockerignore excludes it.
  for (const file of readdirSync(path.dirname(server))) {
    if (file.startsWith(".env")) rmSync(path.join(path.dirname(server), file));
  }

  const child: ChildProcess = spawn(process.execPath, [server], {
    cwd: path.dirname(server),
    stdio: ["ignore", log, log],
    env: {
      PATH: process.env.PATH,
      HOME: home,
      NODE_ENV: "production",
      PORT: String(E2E_PORT),
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      AUTH_SECRET: "e2e-only-not-a-real-secret-0123456789abcdef",
      AUTH_URL: baseUrl,
      AUTH_TRUST_HOST: "true",
      AUTH_GOOGLE_ID: "e2e.apps.googleusercontent.com",
      AUTH_GOOGLE_SECRET: "e2e",
      AUTH_ALLOWED_EMAIL_DOMAINS: "",
      SITE_ADMIN_EMAILS: E2E_BOOTSTRAP_EMAILS.join(","),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });

  const deadline = Date.now() + 60_000;
  while (!(await responds(baseUrl))) {
    if (child.exitCode !== null) {
      throw new Error(`the server exited with ${child.exitCode}; see ${logFile}`);
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`the server did not answer within 60s; see ${logFile}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return {
    baseUrl,
    logFile,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  };
}

async function responds(baseUrl: string): Promise<boolean> {
  try {
    await fetch(`${baseUrl}/signin`, { redirect: "manual", signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}
