// Apply hand-written SQL migrations from drizzle/ against DATABASE_URL.
//
// Drizzle's `push` diffs a schema onto a database; it cannot express a data
// backfill, so changes that have to move data before dropping it live here as
// ordered .sql files and run first. Each file is expected to be idempotent and
// to wrap itself in a transaction.
//
//   node scripts/apply-sql.mjs                 # every drizzle/*.sql, in order
//   node scripts/apply-sql.mjs path/to/one.sql # just this one
//
// Normally invoked through scripts/with-db.sh so DATABASE_URL points at Cloud
// SQL via the proxy.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = "drizzle";

function filesToApply(args) {
  if (args.length > 0) return args;
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(MIGRATIONS_DIR, f));
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
