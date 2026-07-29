// Apply hand-written SQL migrations against DATABASE_URL.
//
// Drizzle's `push` diffs a schema onto a database; it cannot express a data
// backfill, so changes that have to move data before dropping it live as
// ordered .sql files alongside the schema and run first. Each file is expected
// to be idempotent and to wrap itself in a transaction.
//
//   node frontend/scripts/apply-sql.mjs           # every .sql in ../drizzle
//   node frontend/scripts/apply-sql.mjs some/dir  # every .sql in that dir
//   node frontend/scripts/apply-sql.mjs one.sql   # just this one
//
// Lives inside frontend/ so `pg` resolves from the app's node_modules, and
// normally invoked through scripts/with-db.sh so DATABASE_URL points at Cloud
// SQL via the proxy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Migrations live beside the Drizzle schema that generates them. Resolved
 * against this file rather than the working directory, so the Makefile can
 * invoke it from the repo root.
 */
const DEFAULT_MIGRATIONS_DIR = path.resolve(here, "../drizzle");

function sqlFilesIn(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(dir, f));
}

function filesToApply(args) {
  if (args.length === 0) {
    return fs.existsSync(DEFAULT_MIGRATIONS_DIR)
      ? sqlFilesIn(DEFAULT_MIGRATIONS_DIR)
      : [];
  }
  // Accept directories as well as individual files, so the Makefile can pass
  // the migrations directory explicitly.
  return args.flatMap((arg) =>
    fs.existsSync(arg) && fs.statSync(arg).isDirectory() ? sqlFilesIn(arg) : [arg],
  );
}

const files = filesToApply(process.argv.slice(2));
if (files.length === 0) {
  console.log("No SQL migrations to apply.");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (run via scripts/with-db.sh).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// Surface the NOTICEs the migrations raise — on a re-run they are how the
// operator sees which steps were skipped.
client.on("notice", (n) => console.log(`   ${n.message}`));

try {
  for (const file of files) {
    console.log(`>> applying ${file}`);
    await client.query(fs.readFileSync(file, "utf8"));
    console.log(`   ok`);
  }
  console.log("All migrations applied.");
} catch (err) {
  // Each file is a single transaction, so a failure here leaves the database
  // as it was.
  console.error(`\nMigration failed — no changes were committed:\n${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
