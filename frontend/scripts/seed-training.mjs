// Seed Diagnostic placements and Coach Canary progress for everyone with a
// Live Sessions card, so the Diagnostic and Coach Canary lines on a person's
// card have something to show.
//
//   node frontend/scripts/seed-training.mjs           # seed
//   node frontend/scripts/seed-training.mjs --clean   # remove what it seeded
//
// Insert-only: a sitting or a concept row someone already has is left alone.
// Seeded sittings carry question_set 'seed-demo', and seeded concept rows an
// updated_at of 2000-01-01, which is how --clean finds exactly them. Someone
// with no account gets a placeholder one (id 'seed-…', a test account), which
// --clean deletes with everything under it; a real sign-in never uses it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED_SET = "seed-demo";
const SEED_STAMP = "2000-01-01T00:00:00Z";
const SUBJECTS = ["sdlc", "companies", "aisdlc", "pipegen", "champion", "personas"];

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.resolve(here, "../.env");
  if (!fs.existsSync(envFile)) return null;
  const match = fs.readFileSync(envFile, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  return match ? match[1] : null;
}

const connectionString = databaseUrl();
if (!connectionString) {
  console.error("No DATABASE_URL — set it, or add one to frontend/.env.");
  process.exit(1);
}
if (/\/cloudsql\/|(?<!local)host=/.test(connectionString) || !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString)) {
  console.error("DATABASE_URL is not a local database. This script is local-only.");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();

try {
  const { rows: db } = await client.query("select current_database() as name");
  if (process.argv.includes("--clean")) {
    const a = await client.query("delete from iris_attempts where question_set = $1", [SEED_SET]);
    const p = await client.query("delete from mimir_concept_progress where updated_at = $1", [SEED_STAMP]);
    const u = await client.query("delete from users where id like 'seed-%' and is_test_account");
    console.log(`${db[0].name}: removed ${a.rowCount} seeded sittings, ${p.rowCount} seeded concept rows and ${u.rowCount} placeholder accounts.`);
    process.exit(0);
  }

  // Everyone with a Live Sessions card (assessed in a class, or RSVP'd to one) needs an account to hold results.
  const made = await client.query(`
    insert into users (id, name, email, is_test_account)
    select 'seed-' || gen_random_uuid(), coalesce(e.full_name, a.email), a.email, true
      from (select lower(attendee_email) as email from evals_submissions union select lower(email) from intake_responses) a
      left join lateral (select full_name from employees where email = a.email order by active desc limit 1) e on true
     where not exists (select 1 from users u where lower(u.email) = a.email)
    on conflict do nothing`);
  console.log(`Created ${made.rowCount} placeholder accounts.`);
  const { rows: people } = await client.query(`
    select u.id, (select e.track from employees e where e.email = lower(u.email) order by e.active desc limit 1) as employee_track
      from users u
     where lower(u.email) in (select lower(attendee_email) from evals_submissions union select lower(email) from intake_responses)`);

  const { rows: concepts } = await client.query(`
    select c->>'id' as id, exists (select 1 from mimir_concept_videos v where v.concept_id = c->>'id' and v.language = 'en') as has_video
      from (select content from mimir_map_versions order by version desc limit 1) m, jsonb_array_elements(m.content->'concepts') c`);

  let sittings = 0;
  let rows = 0;
  await client.query("begin");
  for (const person of people) {
    // The Diagnostic's overall score needs a track; give one only to someone with none.
    const track = person.employee_track === "engineer" ? "SE" : "AE";
    await client.query(
      `insert into iris_takers (user_id, track) select $1, $2
        where not exists (select 1 from iris_participants p join users u on lower(u.email) = p.email where u.id = $1)
       on conflict (user_id) do nothing`,
      [person.id, track],
    );
    for (const subject of SUBJECTS) {
      const placement = 1 + Math.floor(Math.random() * 3);
      const started = new Date(Date.now() - (1 + Math.random() * 20) * 864e5);
      const r = await client.query(
        `insert into iris_attempts (user_id, subject, form, mode, level, phase, started_at, finished_at, placement, confidence, questions, question_set)
         values ($1, $2, 'A', 'live', $3, 'main', $4, $5, $3, $6, $7, $8)
         on conflict do nothing`,
        [
          person.id,
          subject,
          placement,
          started,
          new Date(started.getTime() + 8 * 60e3),
          ["low", "medium", "high"][Math.floor(Math.random() * 3)],
          10 + Math.floor(Math.random() * 8),
          SEED_SET,
        ],
      );
      sittings += r.rowCount ?? 0;
    }

    // Each person has their own pace: a share of the videos watched, and fewer topics mastered.
    const pace = Math.random();
    for (const c of concepts) {
      const watched = c.has_video && Math.random() < pace;
      const mastered = Math.random() < pace * (watched ? 0.9 : 0.4);
      if (!watched && !mastered) continue;
      const r = await client.query(
        `insert into mimir_concept_progress (user_id, concept_id, video_completed_at, video_updated_at, mastered_at, updated_at)
         values ($1, $2, $3, $3, $4, $5) on conflict do nothing`,
        [person.id, c.id, watched ? new Date() : null, mastered ? new Date() : null, SEED_STAMP],
      );
      rows += r.rowCount ?? 0;
    }
  }
  await client.query("commit");
  console.log(`${db[0].name}: ${people.length} people; added ${sittings} sittings and ${rows} concept rows.`);
} catch (err) {
  await client.query("rollback").catch(() => undefined);
  throw err;
} finally {
  await client.end();
}
