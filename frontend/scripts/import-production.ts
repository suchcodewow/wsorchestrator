/**
 * Replace the local database with a copy of production's. Local only.
 *
 *   cd frontend && npm run db:import-production
 *
 * QA does this from its Backups page by restoring a Cloud SQL backup over its
 * own instance (`runner/src/import-production.ts`). A Cloud SQL backup can only
 * be restored onto another Cloud SQL instance, so here it is a `pg_dump` of
 * production's live database instead, through `scripts/with-db.sh`. The
 * clean-up afterwards is QA's, unchanged: the same quarantine, then the same
 * finish step. docs/environments.md explains why it matters: the local app's
 * Harness, Workspace and cloud credentials are production's accounts too.
 *
 * In order:
 *
 *   1. Refuse unless DATABASE_URL is the local container, and unless this
 *      deployment reads as something other than production.
 *   2. Take a snapshot of the local users who have access.
 *   3. Dump production to a temporary file. `pg_dump` runs in the local
 *      Postgres container: the host has none, and the container's matches
 *      production's major version.
 *   4. Restore the dump into `<database>_import`, beside the local database.
 *   5. Quarantine it and run the finish step there.
 *   6. Drop the local database and rename the copy into its place.
 *
 * Nothing touches the local database before step 6, so a failure anywhere
 * earlier leaves it as it was.
 *
 * Needs gcloud and cloud-sql-proxy signed in as someone who can read
 * production's `database-url` secret and connect to its instance, and no
 * TLS-inspecting VPN (docs/operations.md). `PRODUCTION_GCLOUD_CONFIGURATION`
 * in frontend/.env picks the gcloud configuration.
 */

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { QUARANTINE_SQL } from "../../runner/src/import-policy";
import { drizzle } from "drizzle-orm/node-postgres";
import { auditEvents } from "@/db/schema";
import { deploymentEnvironment } from "@/lib/deployment";
import { finishProductionImport, type UserSnapshot } from "@/lib/production-import";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(frontend, "..");

/** Production's admin project. `with-db.sh` finds the one instance in it. */
const PRODUCTION_PROJECT = process.env.PRODUCTION_PROJECT?.trim() || "administration-459416";

/**
 * The gcloud configuration `with-db.sh` runs under, from frontend/.env. A
 * personal login on a Harness laptop needs a browser re-sign-in every day, so
 * this can name a key-based configuration instead. Only this script's gcloud
 * calls use it; `next dev` ignores it. The proxy uses Application Default
 * Credentials, not this.
 */
const GCLOUD_CONFIGURATION = process.env.PRODUCTION_GCLOUD_CONFIGURATION?.trim();
const gcloudEnv = {
  ...process.env,
  PROJECT: PRODUCTION_PROJECT,
  ...(GCLOUD_CONFIGURATION ? { CLOUDSDK_ACTIVE_CONFIG_NAME: GCLOUD_CONFIGURATION } : {}),
};

/** Fixed by `name:` in docker-compose.yml. */
const CONTAINER = "workshoporchestrator-postgres-1";

/** Thrown rather than exiting, so the dump file is always deleted. */
function fail(message: string): never {
  throw new Error(message);
}

function run(command: string, args: string[], options: SpawnSyncOptions = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    fail(`${command} ${args[0] ?? ""} failed (exit ${result.status ?? result.signal})`);
  }
}

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  /* ------------------------------------------------------------------ */
  /* 1. Where, and as what                                               */
  /* ------------------------------------------------------------------ */

  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) fail("DATABASE_URL is not set. Run this as `npm run db:import-production`.");

  // The same rule as dev-setup.mjs: production's Cloud SQL is on localhost too,
  // through cloud-sql-proxy on :5433 or :6543 and up.
  const target = new URL(databaseUrl);
  const port = Number(target.port || 5432);
  if (!["localhost", "127.0.0.1", "::1"].includes(target.hostname) || port === 5433 || port >= 6543) {
    fail(`DATABASE_URL points at ${target.host}, which is not the local container.`);
  }

  // The finish step clears passwords on the runs that are not this deployment's,
  // and the app hides them from the runner by the same test. Unset here means
  // production, which would make every imported run look local; `next dev` reads
  // "dev" in that case (lib/deployment.ts), so the copy is made to match.
  process.env.DEPLOYMENT_ENVIRONMENT ||= "dev";
  if (deploymentEnvironment() === "production") {
    fail("DEPLOYMENT_ENVIRONMENT is production. An import never runs on production.");
  }

  const database = decodeURIComponent(target.pathname.slice(1));
  const staging = `${database}_import`;
  const urlFor = (name: string) => {
    const url = new URL(databaseUrl);
    url.pathname = `/${encodeURIComponent(name)}`;
    return url.toString();
  };
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

  console.log(`>> Replacing local database ${database} with production's (${PRODUCTION_PROJECT})`);

  /* ------------------------------------------------------------------ */
  /* 2. Who has access here                                              */
  /* ------------------------------------------------------------------ */

  /** The same query as `snapshotUsers` in runner/src/db.ts. */
  async function snapshotUsers(): Promise<UserSnapshot[]> {
    try {
      return await withClient(databaseUrl, async (client) => {
        const { rows } = await client.query<UserSnapshot>(
          `select u.id,
                  u.email,
                  u.name,
                  u.image,
                  u.site_role::text        as "eventRole",
                  u.training_role::text    as "trainingRole",
                  u.evals_role::text       as "evalsRole",
                  u.is_platform_admin      as "isPlatformAdmin",
                  u.calendar_scope::text   as "calendarScope",
                  coalesce(
                    json_agg(json_build_object(
                      'type', a.type,
                      'provider', a.provider,
                      'providerAccountId', a."providerAccountId"
                    )) filter (where a.provider is not null),
                    '[]'
                  ) as accounts
             from users u
             left join accounts a on a."userId" = u.id
            where u.email is not null
              and (u.is_platform_admin
                   or u.site_role <> 'none'
                   or u.training_role is not null
                   or u.evals_role is not null)
            group by u.id
            order by u.email`,
        );
        return rows;
      });
    } catch (err) {
      // No database yet, or one without the users table: nobody to keep.
      // SITE_ADMIN_EMAILS still makes its addresses administrators on sign-in.
      const code = (err as { code?: string }).code;
      if (code === "3D000" || code === "42P01") return [];
      throw err;
    }
  }

  // Checked first: with-db.sh would otherwise find out halfway, from a failed
  // instance listing.
  const token = spawnSync("gcloud", ["auth", "print-access-token"], { env: gcloudEnv, encoding: "utf8" });
  if (token.status !== 0) {
    const reason = (token.stderr || String(token.error ?? "")).split("\n")[0];
    fail(
      `gcloud cannot get a token${GCLOUD_CONFIGURATION ? ` with configuration ${GCLOUD_CONFIGURATION}` : ""}: ${reason}\n` +
        "   Run `gcloud auth login`, or set PRODUCTION_GCLOUD_CONFIGURATION in frontend/.env " +
        "to a gcloud configuration that does not expire.",
    );
  }

  const snapshot = await snapshotUsers();
  console.log(`>> Took a snapshot of ${snapshot.length} local user(s) with access`);

  /* ------------------------------------------------------------------ */
  /* 3. Dump production                                                  */
  /* ------------------------------------------------------------------ */

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "import-production-"));
  const dumpFile = path.join(workdir, "production.dump");

  try {
    // with-db.sh exports DATABASE_URL as production's, on 127.0.0.1 through its
    // proxy. The container reaches the host's loopback as host.docker.internal.
    // Escaped, so with-db.sh's shell expands it once it has set that URL; its
    // ">> Running:" line then echoes the variable's name, not the password.
    const dump =
      `docker exec ${CONTAINER} pg_dump --format=custom --no-owner --no-privileges ` +
      `--dbname="\${DATABASE_URL/127.0.0.1/host.docker.internal}" > '${dumpFile}'`;
    run("bash", [path.join(repo, "scripts/with-db.sh"), dump], {
      cwd: repo,
      env: gcloudEnv,
    });
    const size = fs.statSync(dumpFile).size;
    if (size === 0) fail("pg_dump wrote nothing.");
    console.log(`>> Dumped production (${(size / 1024 / 1024).toFixed(1)} MB)`);

    /* ---------------------------------------------------------------- */
    /* 4. Restore it beside the local database                          */
    /* ---------------------------------------------------------------- */

    // `_import` is this script's own name. One left by a failed run is stale.
    await withClient(urlFor("postgres"), async (client) => {
      await client.query(`drop database if exists ${quote(staging)} with (force)`);
      await client.query(`create database ${quote(staging)}`);
    });

    const input = fs.openSync(dumpFile, "r");
    try {
      run(
        "docker",
        ["exec", "-i", CONTAINER, "pg_restore", "--no-owner", "--no-privileges",
          "--exit-on-error", "-U", target.username || "postgres", "-d", staging],
        { stdio: [input, "inherit", "inherit"] },
      );
    } finally {
      fs.closeSync(input);
    }
    console.log(`>> Restored into ${staging}`);

    /* ---------------------------------------------------------------- */
    /* 5. QA's clean-up, on the copy                                    */
    /* ---------------------------------------------------------------- */

    await withClient(urlFor(staging), async (client) => {
      await client.query("begin");
      try {
        for (const statement of QUARANTINE_SQL) await client.query(statement);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      }
    });
    console.log("   stamped every run as production's and cleared production's sessions");

    const result = await finishProductionImport(
      { snapshot },
      { migrationsDir: path.join(frontend, "drizzle"), connectionString: urlFor(staging) },
    );
    console.log(
      `   applied ${result.migrations.length} migrations, cleared ${result.attendeePasswordsCleared} ` +
        `attendee password(s), restored ${result.usersRestored} user(s) and added ${result.usersAdded}`,
    );

    // Written into the copy, so it is the first thing the swapped-in database
    // records. Not `recordAudit`: lib/audit.ts imports Next's request context,
    // which does not load outside Next.
    await withClient(urlFor(staging), (client) =>
      drizzle(client).insert(auditEvents).values({
        actorName: process.env.USER || "local import",
        via: "system",
        action: "local.import-production",
        summary: `Replaced the local database with a copy of production's (${PRODUCTION_PROJECT})`,
        outcome: "succeeded",
        detail: { project: PRODUCTION_PROJECT, ...result, migrations: result.migrations.length },
      }),
    );

    /* ---------------------------------------------------------------- */
    /* 6. Swap it in                                                    */
    /* ---------------------------------------------------------------- */

    // `with (force)` ends the dev server's connections; its pool reconnects to
    // the new database on its next query.
    await withClient(urlFor("postgres"), async (client) => {
      await client.query(`drop database if exists ${quote(database)} with (force)`);
      try {
        await client.query(`alter database ${quote(staging)} rename to ${quote(database)}`);
      } catch (err) {
        fail(
          `dropped ${database} but could not rename ${staging} into its place: ${String(err)}. ` +
            `Run: alter database ${quote(staging)} rename to ${quote(database)}`,
        );
      }
    });

    console.log(`>> Done. ${database} is now production's data, with production's runs read-only.`);
    console.log("   Sign in again: the import cleared every session.");
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

main().then(
  // Exits outright: `@/db`, imported by the finish step's module, holds a pool.
  () => process.exit(0),
  (err) => {
    console.error(`!! ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
