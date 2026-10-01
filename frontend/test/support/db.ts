/**
 * The database the `test:db` and `test:e2e` suites write to, and the guard that
 * keeps them off anything that matters.
 *
 * The local `workshops` database holds real authored work and production is one
 * port-forward away, so the suites do not trust `DATABASE_URL` to be right:
 * they ask the server which database it is and refuse to go on unless the name
 * is one of the scratch databases. Every row they create carries `TEST_PREFIX`
 * in its id or email, and cleanup deletes by that and nothing else.
 */

import pg from "pg";

export const SCRATCH_DATABASES = ["workshops_agent", "workshops_test"];

export const DEFAULT_TEST_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/workshops_agent";

/** Prefix on the id of every user a suite creates; cleanup is scoped to it. */
export const TEST_PREFIX = "wo_test_";

/** Domain of every email a suite creates. `.test` is reserved; it cannot be real. */
export const TEST_EMAIL_DOMAIN = "roles.test";

export function testDatabaseUrl(): string {
  return process.env.DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
}

export async function assertScratchDatabase(url = testDatabaseUrl()): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `cannot reach the test database (${redact(url)}): ${(err as Error).message}. ` +
        "Create it with `npm run dev:setup`, or start the container with `npm run db:up`.",
    );
  }
  try {
    const { rows } = await client.query<{ db: string }>("select current_database() as db");
    const name = rows[0]!.db;
    if (!SCRATCH_DATABASES.includes(name)) {
      throw new Error(
        `refusing to run against database "${name}": tests only write to ${SCRATCH_DATABASES.join(" or ")}`,
      );
    }
  } finally {
    await client.end();
  }
}

/**
 * Removes everything one suite created — the users whose id starts with
 * `TEST_PREFIX` + `scope` — children first: `workshop_runs.user_id` does not
 * cascade, and a run left behind would keep its owner alive. Sessions, tokens
 * and the rest cascade from the user.
 */
export async function deleteTestRows(
  query: (sql: string, params: unknown[]) => Promise<unknown>,
  scope: string,
) {
  if (!/^[a-z0-9]+_$/.test(scope)) throw new Error(`bad test scope "${scope}"`);
  const like = `${TEST_PREFIX}${scope}%`;
  await query(
    "delete from workshop_runs where user_id in (select id from users where id like $1)",
    [like],
  );
  await query("delete from users where id like $1", [like]);
}

function redact(url: string): string {
  return url.replace(/\/\/([^:/@]+):[^@]*@/, "//$1:***@");
}
