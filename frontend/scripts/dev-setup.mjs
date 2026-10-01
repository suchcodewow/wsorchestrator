// Local setup, run by `npm run dev:setup` once the Postgres container is up.
// Safe to run again at any time.
//
//   1. frontend/.env from .env.example, with a real AUTH_SECRET in place of the
//      placeholder.
//   2. Both local databases — `workshops` (DATABASE_URL) and the scratch
//      `workshops_agent` that the test suites and agents use — created if
//      missing, then given the schema and the hand-written migrations. That is
//      what deploy_qa does to an empty Cloud SQL database: `drizzle-kit push`
//      for the shape, then the .sql files for the rows a fresh database needs
//      (the baseline `harness_components`, among others).
//
// A database that already has tables is left alone. `push --force` drops any
// column it no longer sees in the schema, and `workshops` holds real authored
// work. CONTRIBUTING.md#changing-the-schema covers bringing an existing
// database up to date.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(frontend, ".env");
const SCRATCH = "workshops_agent";

if (!fs.existsSync(envFile)) {
  fs.copyFileSync(path.join(frontend, ".env.example"), envFile);
  console.log("created frontend/.env from .env.example");
}

let env = fs.readFileSync(envFile, "utf8");
if (/^AUTH_SECRET\s*=\s*"?(replace-me)?"?\s*$/m.test(env) || !/^AUTH_SECRET\s*=/m.test(env)) {
  const line = `AUTH_SECRET="${randomBytes(32).toString("base64")}"`;
  env = /^AUTH_SECRET\s*=/m.test(env)
    ? env.replace(/^AUTH_SECRET\s*=.*$/m, line)
    : `${env.trimEnd()}\n${line}\n`;
  fs.writeFileSync(envFile, env);
  console.log("wrote a new AUTH_SECRET into frontend/.env");
}

const databaseUrl =
  process.env.DATABASE_URL ?? env.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m)?.[1];
if (!databaseUrl) {
  console.error("No DATABASE_URL in frontend/.env.");
  process.exit(1);
}

// Production's Cloud SQL is reachable on localhost too, through
// cloud-sql-proxy on :5433 or :6543 and up (docs/operations.md). This script
// creates databases, so it refuses anything that is not plainly the container.
const target = new URL(databaseUrl);
const port = Number(target.port || 5432);
if (!["localhost", "127.0.0.1", "::1"].includes(target.hostname) || port === 5433 || port >= 6543) {
  console.error(`DATABASE_URL points at ${target.host}, which is not the local container. Refusing.`);
  process.exit(1);
}

function urlFor(database) {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function run(command, args, url) {
  const result = spawnSync(command, args, {
    cwd: frontend,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const databases = [...new Set([target.pathname.slice(1), SCRATCH])];

await withClient(urlFor("postgres"), async (client) => {
  for (const name of databases) {
    const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (!rowCount) {
      await client.query(`create database "${name.replaceAll('"', '""')}"`);
      console.log(`created database ${name}`);
    }
  }
});

for (const name of databases) {
  const url = urlFor(name);
  const tables = await withClient(url, async (client) => {
    const { rows } = await client.query(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
    );
    return rows[0].n;
  });
  if (tables > 0) {
    console.log(`${name}: already set up (${tables} tables), left alone`);
    continue;
  }
  console.log(`${name}: empty, applying the schema and migrations`);
  run("npx", ["drizzle-kit", "push", "--force"], url);
  run(process.execPath, ["scripts/apply-sql.mjs"], url);
}

console.log("\nLocal databases ready. Next: fill in AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET, then `npm run dev`.");
