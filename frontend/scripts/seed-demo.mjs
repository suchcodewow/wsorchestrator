// Seed a fully-built demo event into a local database, so the run page and the
// attendee page can be worked on without a real provision.
//
// Both pages are pure reads — the run view reads `workshop_runs` + `run_logs` +
// `workshop_accounts` + `run_resources`, the attendee page reads the run and its
// accounts — so everything they render can be written directly. Nothing here
// touches a cloud, Workspace, or Harness.
//
//   node frontend/scripts/seed-demo.mjs                    # the default event
//   node frontend/scripts/seed-demo.mjs --status applying  # mid-build instead
//   node frontend/scripts/seed-demo.mjs --clean            # remove seeded rows
//
// Every row it writes is marked with `seeded_demo` in the run's outputs, and
// --clean deletes exactly those runs (the child tables cascade). Real events
// have no such marker and are never touched.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ *
 * Options
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = {
    name: "Multicloud Platform Workshop",
    mode: "workshop",
    users: 10,
    clouds: ["aws", "azure", "gcp"],
    status: "ready",
    days: 5,
    // How many rows the room has already filled in, so the grid shows both
    // states side by side rather than ten identical empty cards.
    claimed: 6,
    owner: null,
    clean: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i];
    switch (arg) {
      case "--clean": opts.clean = true; break;
      case "--name": opts.name = value(); break;
      case "--mode": opts.mode = value(); break;
      case "--users": opts.users = Number(value()); break;
      case "--clouds": opts.clouds = value().split(",").filter(Boolean); break;
      case "--status": opts.status = value(); break;
      case "--days": opts.days = Number(value()); break;
      case "--claimed": opts.claimed = Number(value()); break;
      case "--owner": opts.owner = value(); break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

/**
 * DATABASE_URL from the environment, else from frontend/.env — this is a local
 * dev tool, and requiring the variable to be exported first is friction with no
 * safety in it. Resolved against this file so it runs from anywhere.
 */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.resolve(here, "../.env");
  if (!fs.existsSync(envFile)) return null;
  const match = fs
    .readFileSync(envFile, "utf8")
    .match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  return match ? match[1] : null;
}

const connectionString = databaseUrl();
if (!connectionString) {
  console.error("No DATABASE_URL — set it, or add one to frontend/.env.");
  process.exit(1);
}

// A refusal, not a warning: this writes fabricated events, and the one place
// they must never appear is the deployed database.
if (/\/cloudsql\/|(?<!local)host=/.test(connectionString)) {
  console.error("DATABASE_URL looks like Cloud SQL. This script is local-only.");
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * Fabricated values, shaped like the ones the runner writes
 * ------------------------------------------------------------------ */

const DOMAIN = process.env.GOOGLE_WORKSPACE_DOMAIN ?? "harnessevents.io";
const HARNESS_BASE = process.env.HARNESS_BASE_URL ?? "https://app.harness.io";
const HARNESS_ACCOUNT = process.env.HARNESS_ACCOUNT_ID ?? "wlgELJ0TTre5aZhzEeQnmw";
const AZURE_TENANT = process.env.AZURE_TENANT_ID ?? "f7c0a1e2-3b4d-4a5e-9c8f-2d1b6e0a7c93";

const ADJECTIVES = [
  "bouncy", "clever", "dapper", "feisty", "giddy", "jaunty", "mellow",
  "nimble", "plucky", "quirky", "snazzy", "spiffy", "sunny", "witty", "zesty",
];
const NOUNS = [
  "axolotl", "badger", "capybara", "dumpling", "flamingo", "gecko",
  "hedgehog", "kestrel", "lemur", "marmot", "narwhal", "otter", "pangolin",
  "quokka", "toucan", "walrus", "wombat",
];

const pick = (list) => list[crypto.randomInt(list.length)];

/** Matches the runner: base64url, plus `aA1!` for the required character mix. */
const password = () =>
  crypto.randomBytes(12).toString("base64url").slice(0, 16) + "aA1!";

/** An Entra Temporary Access Pass is a short alphanumeric code. */
const accessPass = () => crypto.randomBytes(8).toString("hex").slice(0, 8);

/** Distinct `adjectivenoun` local parts, the way the runner generates them. */
function usernames(count) {
  const seen = new Set();
  while (seen.size < count) seen.add(`${pick(ADJECTIVES)}${pick(NOUNS)}`);
  return [...seen];
}

function slugify(name) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "workshop"
  );
}

/** A slug cut to fit an identifier, never leaving a dash against the join. */
const trim = (slug, max) => slug.slice(0, max).replace(/-+$/, "");

/** ws-<slug>-<short>, the id the runner builds a workshop's project under. */
const projectId = (slug, runId) =>
  `ws-${trim(slug, 20)}-${runId.replace(/-/g, "").slice(0, 6)}`;

/** <identifier>_<short>, matching `orgIdentifier` in the runner. */
const harnessOrgId = (name, runId) =>
  `${name.replace(/[^A-Za-z0-9_$]/g, "_").slice(0, 55)}_${runId.replace(/-/g, "").slice(0, 6)}`;

/** The org's console page, matching `orgUrl` in the runner. */
const harnessOrgUrl = (orgId) =>
  `${HARNESS_BASE}/ng/account/${HARNESS_ACCOUNT}/settings/organizations/${orgId}/details`;

/** One attendee's project id, matching `projectIdentifier` in the runner. */
const harnessProjectId = (email) =>
  (email.split("@")[0] ?? email).replace(/[^0-9a-zA-Z_$]+/g, "_") || "attendee";

/** That project's console page, matching `projectUrl` in the runner. */
const harnessProjectUrl = (orgId, projectId) =>
  `${HARNESS_BASE}/ng/account/${HARNESS_ACCOUNT}/home/orgs/${orgId}/projects/${projectId}/details`;

// Answers for the rows the room has already filled in. Nothing here is a real
// person — they only exist to give the grid something to lay out.
const CLAIMS = [
  ["Priya Raman", "Bengaluru", "Backpacking in Ladakh"],
  ["Marcus Ellery", "Chicago", "A cabin on Lake Superior"],
  ["Sofia Duarte", "Lisbon", "Diving in the Azores"],
  ["Tomas Lindqvist", "Stockholm", "Skiing in Åre"],
  ["Amara Nwosu", "Lagos", "Road trip along the coast"],
  ["Kenji Watanabe", "Osaka", "Hot springs in Hakone"],
  ["Elena Vasquez", "Madrid", "Walking the Camino"],
  ["Dara Okonkwo", "Dublin", "Island hopping in Greece"],
  ["Nils Bergmann", "Hamburg", "Cycling the Danube"],
  ["Rosa Milani", "Milan", "A week in Puglia"],
];

/**
 * The Terraform outputs a workshop's roots emit, restricted to the clouds the
 * event asked for. Keys and URL shapes match runner/terraform/workshops/*.
 */
function buildOutputs(clouds, slug, runId) {
  const out = { seeded_demo: true };
  const short = runId.replace(/-/g, "").slice(0, 6);

  if (clouds.includes("gcp")) {
    const project = projectId(slug, runId);
    out.gcp_project_id = project;
    out.gcp_console_url = `https://console.cloud.google.com/home/dashboard?project=${project}`;
    out.gke_cluster_name = `ws-${trim(slug, 16)}-${short}`;
    out.gke_cluster_location = "us-central1";
  }
  if (clouds.includes("azure")) {
    const group = `ws-${trim(slug, 20)}-${short}`;
    const subscription = "3f9d2c81-64ab-4e77-9a52-8c0d15b7e4a6";
    out.azure_resource_group = group;
    out.azure_portal_url =
      `https://portal.azure.com/#@${AZURE_TENANT}/resource/subscriptions/` +
      `${subscription}/resourceGroups/${group}`;
    out.aks_cluster_name = `ws-${trim(slug, 16)}-${short}`;
    out.aks_cluster_location = "eastus";
  }
  if (clouds.includes("aws")) {
    const account = String(100000000000 + crypto.randomInt(899999999999));
    out.aws_account_id = account;
    out.aws_console_url = `https://${account}.signin.aws.amazon.com/console`;
    out.eks_cluster_name = `ws-${trim(slug, 16)}-${short}`;
  }
  return out;
}

/**
 * What the run page lists as built, in the order a real build confirms it:
 * directory first, then Harness, then each cloud's apply.
 */
function buildResources(clouds, outputs, orgUnitPath, orgId, users) {
  const rows = [
    { kind: "org_unit", label: "Google Workspace org unit", detail: orgUnitPath },
    { kind: "accounts", label: "Attendee accounts", done: users, total: users },
    {
      kind: "harness_org",
      label: "Harness organization",
      detail: orgId,
      url: harnessOrgUrl(orgId),
    },
    {
      kind: "harness_projects",
      label: "Harness projects",
      detail: "one per attendee",
      done: users,
      total: users,
    },
  ];

  if (clouds.includes("gcp")) {
    rows.push(
      {
        kind: "gcp_project",
        label: "GCP project",
        detail: outputs.gcp_project_id,
        url: outputs.gcp_console_url,
      },
      {
        kind: "gke_cluster",
        label: "GKE cluster",
        detail: `${outputs.gke_cluster_name} (${outputs.gke_cluster_location})`,
      },
    );
  }
  if (clouds.includes("azure")) {
    rows.push(
      {
        kind: "azure_resource_group",
        label: "Azure resource group",
        detail: outputs.azure_resource_group,
        url: outputs.azure_portal_url,
      },
      {
        kind: "aks_cluster",
        label: "AKS cluster",
        detail: `${outputs.aks_cluster_name} (${outputs.aks_cluster_location})`,
      },
    );
  }
  if (clouds.includes("aws")) {
    rows.push(
      {
        kind: "aws_account",
        label: "AWS account",
        detail: outputs.aws_account_id,
        url: outputs.aws_console_url,
      },
      { kind: "eks_cluster", label: "EKS cluster", detail: outputs.eks_cluster_name },
    );
  }

  for (const cloud of clouds) {
    rows.push({
      kind: "harness_delegate",
      key: cloud,
      label: `Harness delegate (${cloud.toUpperCase()})`,
      detail: `ws-delegate-${cloud}`,
    });
  }
  return rows;
}

/** A build transcript, in the voice the runner actually logs in. */
function buildLogs(opts, outputs, orgUnitPath, orgId, emails) {
  const l = [];
  const say = (stream, message) => l.push({ stream, message });

  say("system",
    `Scheduled ${opts.mode} "${opts.name}" to start now — ` +
    `${opts.users} attendees, ${opts.clouds.join(", ")}, ` +
    `runs ${opts.days} days before teardown`);
  say("system", `Creating organizational unit "${opts.name}"`);
  say("system", `Org unit ready at ${orgUnitPath}`);
  say("system", `Creating ${opts.users} attendee account(s)`);
  for (const email of emails) say("stdout", `created ${email}`);
  say("system", `Creating Harness organization ${orgId}`);
  say("stdout", `${opts.users} Harness project(s) created`);

  for (const cloud of opts.clouds) {
    say("system", `Applying ${cloud.toUpperCase()} environment`);
    say("stdout", "Terraform has been successfully initialized!");
    say("stdout", "Apply complete! Resources: 34 added, 0 changed, 0 destroyed.");
  }
  if (opts.clouds.includes("azure")) {
    say("system", `Issuing Temporary Access Passes for ${opts.users} attendee(s)`);
  }
  for (const cloud of opts.clouds) {
    say("system", `Installing org Harness delegate "ws-delegate-${cloud}"`);
    say("stdout", `delegate ws-delegate-${cloud} installed`);
  }
  return l;
}

/* ------------------------------------------------------------------ *
 * Write
 * ------------------------------------------------------------------ */

const client = new pg.Client({ connectionString });
await client.connect();

try {
  if (opts.clean) {
    const { rows } = await client.query(
      `delete from workshop_runs
        where outputs->>'seeded_demo' = 'true'
        returning id, name`,
    );
    console.log(rows.length === 0 ? "No seeded events to remove." : `Removed ${rows.length} seeded event(s):`);
    for (const r of rows) console.log(`   ${r.name}  ${r.id}`);
    process.exit(0);
  }

  // The run needs a real owner: `user_id` is a foreign key, and the run page
  // resolves the viewer against it to decide whose event this is.
  const { rows: owners } = await client.query(
    opts.owner
      ? `select id, email from users where email = $1`
      : `select id, email from users order by site_role = 'administrator' desc, email limit 1`,
    opts.owner ? [opts.owner] : [],
  );
  if (owners.length === 0) {
    console.error(
      opts.owner
        ? `No user with email ${opts.owner}.`
        : "No users in this database — sign in locally once first.",
    );
    process.exit(1);
  }
  const owner = owners[0];

  const runId = crypto.randomUUID();
  const slug = slugify(opts.name);
  const orgUnitPath = `/Workshops/${opts.name}`;
  const orgId = harnessOrgId(opts.name, runId);
  const outputs = buildOutputs(opts.clouds, slug, runId);
  // Cloud-independent, so it is set here rather than in `buildOutputs`: every
  // event gets a Harness org, and the attendee page links the room to it.
  outputs.harness_org = orgId;
  outputs.harness_org_url = harnessOrgUrl(orgId);
  const locals = usernames(opts.users);
  const emails = locals.map((u) => `${u}@${DOMAIN}`);
  // One project per attendee, keyed by address — the map the attendee page
  // reads to put a project link on each row.
  outputs.harness_project_urls = Object.fromEntries(
    emails.map((email) => [email, harnessProjectUrl(orgId, harnessProjectId(email))]),
  );

  const now = Date.now();
  const ttlSeconds = opts.days * 86400;
  // Provisioned ahead of its start time, the way the scheduler does it, so the
  // build log sits just behind "now" rather than in the future.
  const startedAt = new Date(now - 12 * 60 * 1000);
  const expiresAt = new Date(now + ttlSeconds * 1000);
  const ready = opts.status === "ready";

  await client.query("begin");

  await client.query(
    `insert into workshop_runs
       (id, user_id, name, mode, slug, user_count, clouds, status,
        scheduled_start, org_unit_path, gcp_project_id, state_prefix,
        outputs, ttl_seconds, expires_at, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16)`,
    [
      runId,
      owner.id,
      opts.name,
      opts.mode,
      slug,
      opts.users,
      opts.clouds,
      opts.status,
      new Date(now),
      orgUnitPath,
      outputs.gcp_project_id ?? null,
      `workshops/${runId}`,
      JSON.stringify(outputs),
      ttlSeconds,
      ready ? expiresAt : null,
      startedAt,
    ],
  );

  const hasAzure = opts.clouds.includes("azure");
  for (const [i, email] of emails.entries()) {
    const claim = i < opts.claimed ? CLAIMS[i % CLAIMS.length] : null;
    await client.query(
      `insert into workshop_accounts
         (run_id, email, temp_password, azure_access_pass,
          azure_access_pass_expires_at, claimed_name, claimed_from,
          claimed_vacation, claimed_at, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        runId,
        email,
        password(),
        hasAzure ? accessPass() : null,
        // Sized to outlast the event, as the runner does.
        hasAzure ? new Date(expiresAt.getTime() + 3600 * 1000) : null,
        claim?.[0] ?? null,
        claim?.[1] ?? null,
        claim?.[2] ?? null,
        claim ? new Date(now - (opts.claimed - i) * 90 * 1000) : null,
        startedAt,
      ],
    );
  }

  const logs = buildLogs(opts, outputs, orgUnitPath, orgId, emails);
  if (ready) {
    logs.push({
      stream: "system",
      message: `Ready. Auto-destroys at ${expiresAt.toISOString()}`,
    });
  }
  // Spread evenly across the build window so the log reads as a timeline.
  const step = (now - startedAt.getTime()) / (logs.length + 1);
  for (const [i, entry] of logs.entries()) {
    await client.query(
      `insert into run_logs (run_id, ts, stream, message) values ($1,$2,$3,$4)`,
      [runId, new Date(startedAt.getTime() + step * (i + 1)), entry.stream, entry.message],
    );
  }

  const resources = buildResources(opts.clouds, outputs, orgUnitPath, orgId, opts.users);
  for (const [i, r] of resources.entries()) {
    const at = new Date(startedAt.getTime() + step * (i + 1));
    await client.query(
      `insert into run_resources
         (run_id, kind, key, label, detail, url, done, total, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
      [runId, r.kind, r.key ?? "", r.label, r.detail ?? null, r.url ?? null,
       r.done ?? null, r.total ?? null, at],
    );
  }

  await client.query("commit");

  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  console.log(`Seeded "${opts.name}" (${opts.status})`);
  console.log(`   owner     ${owner.email}`);
  console.log(`   attendees ${opts.users} (${opts.claimed} claimed)`);
  console.log(`   clouds    ${opts.clouds.join(", ")}`);
  console.log(`   destroys  ${expiresAt.toISOString()}`);
  console.log("");
  console.log(`   build page    ${base}/runs/${runId}`);
  console.log(`   attendee page ${base}/attend/${runId}`);
  console.log("");
  console.log("   remove with: node frontend/scripts/seed-demo.mjs --clean");
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error(`Seed failed — nothing was written:\n${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
