// A git worktree's own throwaway copy of the local database, so one branch's
// migrations never reach the database every other checkout is using.
//
//   npm run db:worktree              # create workshops_wt_<branch>, copied from
//                                    # the main checkout's database, point this
//                                    # worktree's frontend/.env at it, migrate it
//   npm run db:worktree -- --fresh   # throw it away and copy again
//   npm run db:worktree:drop         # drop it, before removing the worktree
//
// The copy is disposable: what you author in it is gone when it is dropped.
// Schema changes reach other databases as drizzle/*.sql files merged with the
// code, never by copying a database back. Run from the worktree, not the main
// checkout, whose database is the one being copied.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CONTAINER,
  applyMigrations,
  databaseName,
  databaseUrlFrom,
  databaseUrlIn,
  frontend,
  isCloudSql,
  isLocalContainer,
  quoteIdent,
  urlFor,
  withClient,
} from "./local-db.mjs";

const PREFIX = "workshops_wt_";
const root = path.resolve(frontend, "..");
const envFile = path.join(frontend, ".env");
const [command = "create", ...flags] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function git(...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) fail(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

/** The first worktree git lists is the main checkout. */
const mainRoot = git("worktree", "list", "--porcelain").match(/^worktree (.+)$/m)?.[1];
if (!mainRoot || fs.realpathSync(mainRoot) === fs.realpathSync(root)) {
  fail("This is the main checkout, whose database the worktrees copy. Run this inside a worktree.");
}

function setDatabaseUrl(url) {
  const env = fs.readFileSync(envFile, "utf8");
  const line = `DATABASE_URL="${url}"`;
  fs.writeFileSync(
    envFile,
    /^DATABASE_URL\s*=/m.test(env) ? env.replace(/^DATABASE_URL\s*=.*$/m, line) : `${env.trimEnd()}\n${line}\n`,
  );
}

async function assertLocal(url) {
  if (!isLocalContainer(url) || (await withClient(urlFor(url, "postgres"), isCloudSql))) {
    fail(`${new URL(url).host} is not the local container. Refusing.`);
  }
}

async function exists(url, name) {
  return withClient(urlFor(url, "postgres"), async (client) => {
    const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [name]);
    return rowCount > 0;
  });
}

async function dropDatabase(url, name) {
  if (!name.startsWith(PREFIX)) fail(`${name} is not a worktree database (${PREFIX}*). Refusing to drop it.`);
  // FORCE ends this worktree's own dev server's connections, which are the only ones it should have.
  await withClient(urlFor(url, "postgres"), (client) =>
    client.query(`drop database if exists ${quoteIdent(name)} with (force)`),
  );
}

/**
 * pg_dump of `source` piped into pg_restore of `target`, both inside the
 * container. The names go in as arguments, never into the script text.
 */
function copy(user, source, target) {
  const result = spawnSync(
    "bash",
    [
      "-c",
      'set -o pipefail; docker exec "$1" pg_dump -U "$2" -Fc "$3" | docker exec -i "$1" pg_restore -U "$2" --no-owner --no-acl -d "$4"',
      "copy",
      CONTAINER,
      user,
      source,
      target,
    ],
    { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] },
  );
  if (result.status !== 0) throw new Error(result.stderr?.trim() || "pg_dump | pg_restore failed");
}

async function create() {
  const fresh = flags.includes("--fresh");
  if (!fs.existsSync(envFile)) {
    const mainEnv = path.join(mainRoot, "frontend", ".env");
    if (!fs.existsSync(mainEnv)) fail("Neither this worktree nor the main checkout has frontend/.env. Run npm run dev:setup in the main checkout first.");
    fs.copyFileSync(mainEnv, envFile);
    console.log("copied frontend/.env from the main checkout");
  }

  // The main checkout's database is the source, whatever this worktree's .env names now.
  const sourceUrl = databaseUrlIn(path.join(mainRoot, "frontend", ".env"));
  if (!sourceUrl) fail("The main checkout's frontend/.env has no DATABASE_URL.");
  await assertLocal(sourceUrl);
  const source = databaseName(sourceUrl);

  const slug = git("rev-parse", "--abbrev-ref", "HEAD").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const name = `${PREFIX}${slug || "detached"}`.slice(0, 63);
  if (name === source) fail(`The worktree database would be ${source} itself. Refusing.`);
  const url = urlFor(sourceUrl, name);

  if (await exists(sourceUrl, name)) {
    if (fresh) {
      await dropDatabase(sourceUrl, name);
      console.log(`dropped ${name}`);
    } else {
      console.log(`${name} already exists, kept (--fresh copies ${source} again)`);
    }
  }
  if (!(await exists(sourceUrl, name))) {
    await withClient(urlFor(sourceUrl, "postgres"), (client) =>
      client.query(`create database ${quoteIdent(name)}`),
    );
    try {
      copy(decodeURIComponent(new URL(sourceUrl).username) || "postgres", source, name);
    } catch (err) {
      await dropDatabase(sourceUrl, name);
      fail(`Copying ${source} into ${name} failed, and ${name} was dropped:\n${err.message}`);
    }
    console.log(`copied ${source} into ${name}`);
  }

  setDatabaseUrl(url);
  console.log(`frontend/.env now uses ${name}`);
  if (!applyMigrations(url)) fail("A migration failed against the copy.");
  console.log("\nRestart this worktree's dev server if it is running. npm run db:worktree:drop removes the copy.");
}

async function drop() {
  const url = databaseUrlFrom(envFile);
  if (!url) fail("frontend/.env has no DATABASE_URL.");
  await assertLocal(url);
  const name = databaseName(url);
  await dropDatabase(url, name);
  console.log(`dropped ${name}. frontend/.env still names it; npm run db:worktree makes a new copy.`);
}

if (command === "create") await create();
else if (command === "drop") await drop();
else fail(`Unknown command ${command}: use create or drop.`);
