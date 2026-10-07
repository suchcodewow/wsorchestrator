// What the local-database scripts share (dev-setup.mjs, migrate-local.mjs,
// worktree-db.mjs): finding DATABASE_URL, refusing anything that is not plainly
// the local container, and running the hand-written migrations.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** docker-compose.yml fixes the project name, so this is the container in every clone. */
export const CONTAINER = "workshoporchestrator-postgres-1";

/** DATABASE_URL from the environment, else from that .env file, as `next dev` resolves it. */
export function databaseUrlFrom(envFile) {
  return process.env.DATABASE_URL || databaseUrlIn(envFile);
}

/** DATABASE_URL as that .env file sets it, ignoring the environment. */
export function databaseUrlIn(envFile) {
  if (!fs.existsSync(envFile)) return null;
  return fs.readFileSync(envFile, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m)?.[1] ?? null;
}

/**
 * Production's Cloud SQL is reachable on localhost too, through
 * cloud-sql-proxy on :5433 or :6543 and up (docs/operations.md), so a host of
 * localhost is not enough on its own.
 */
export function isLocalContainer(databaseUrl) {
  const target = new URL(databaseUrl);
  const port = Number(target.port || 5432);
  return ["localhost", "127.0.0.1", "::1"].includes(target.hostname) && port !== 5433 && port < 6543;
}

/** Cloud SQL's own role, which no local Postgres has: the check that does not depend on a port. */
export async function isCloudSql(client) {
  const { rows } = await client.query(
    "select exists (select 1 from pg_roles where rolname = 'cloudsqlsuperuser') as cloud",
  );
  return rows[0].cloud;
}

export function databaseName(databaseUrl) {
  return decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
}

export function urlFor(databaseUrl, database) {
  const url = new URL(databaseUrl);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
}

export async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export function quoteIdent(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Runs a command in frontend/ against `url`, and exits with it if it fails. */
export function run(command, args, url) {
  const result = spawnSync(command, args, {
    cwd: frontend,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/**
 * Every drizzle/*.sql against `url`, quietly: one line when they all pass,
 * apply-sql's whole output when one fails. Returns whether they passed.
 */
export function applyMigrations(url) {
  const result = spawnSync(process.execPath, ["scripts/apply-sql.mjs"], {
    cwd: frontend,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: url },
  });
  if (result.status === 0) {
    const files = (result.stdout.match(/^>> applying /gm) ?? []).length;
    console.log(`migrations: all ${files} applied to ${databaseName(url)}`);
    return true;
  }
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  return false;
}
