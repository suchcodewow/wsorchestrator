// `predev`: brings the local database up to this checkout's migrations before
// `npm run dev` starts, so a pull, a merge or a branch switch never leaves the
// app reading a column the database lacks. Every drizzle/*.sql runs every time;
// each is written to be re-runnable, so the ones already applied do nothing.
//
// Local only. A DATABASE_URL that is not the container, or a server that turns
// out to be Cloud SQL, is skipped with a note rather than migrated, so a
// proxy left on DATABASE_URL never releases a migration by starting a dev
// server. Anything else that stops it from running is a note too, and the dev
// server starts anyway; only a migration that fails stops it, since the app
// would then be running against a half-changed schema.
//
//   SKIP_DEV_MIGRATE=1 npm run dev     # start without it
import path from "node:path";
import {
  applyMigrations,
  databaseName,
  databaseUrlFrom,
  frontend,
  isCloudSql,
  isLocalContainer,
  withClient,
} from "./local-db.mjs";

if (process.env.SKIP_DEV_MIGRATE) process.exit(0);

const url = databaseUrlFrom(path.join(frontend, ".env"));
if (!url) {
  console.log("migrations: no DATABASE_URL, skipped (npm run dev:setup creates frontend/.env)");
  process.exit(0);
}
if (!isLocalContainer(url)) {
  console.log(`migrations: DATABASE_URL is ${new URL(url).host}, not the local container, skipped`);
  process.exit(0);
}

let state;
try {
  state = await withClient(url, async (client) => {
    if (await isCloudSql(client)) return "cloud";
    const { rows } = await client.query(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
    );
    return rows[0].n > 0 ? "ready" : "empty";
  });
} catch (err) {
  // A refused connection is an AggregateError with an empty message; its code says it.
  const why = err.code ?? (err.message || "no answer");
  console.log(`migrations: could not reach ${databaseName(url)} (${why}), skipped. Is Postgres up? npm run db:up`);
  process.exit(0);
}

if (state === "cloud") {
  console.log("migrations: DATABASE_URL reaches Cloud SQL, skipped");
  process.exit(0);
}
if (state === "empty") {
  console.log(`migrations: ${databaseName(url)} has no tables, skipped. npm run dev:setup gives it the schema`);
  process.exit(0);
}

if (!applyMigrations(url)) {
  console.error("\nA migration failed, so the dev server was not started. Fix it, or SKIP_DEV_MIGRATE=1 npm run dev.");
  process.exit(1);
}
