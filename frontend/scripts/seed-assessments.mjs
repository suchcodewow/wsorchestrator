// Seed BTC assessments for everyone who has RSVP'd to a bootcamp: a scored
// submission (criterion scores and comments, positive and constructive
// feedback) for each active BTC assessment taught to their track, plus the
// class review (entrance and exit exam, overall feedback), at the active
// bootcamp, or else the newest one that has begun.
//
//   node frontend/scripts/seed-assessments.mjs           # seed
//   node frontend/scripts/seed-assessments.mjs --clean   # remove what it seeded
//
// Insert-only: a submission or review someone already has is left alone.
// Everything it writes has an updated_at of 2000-01-01, which is how --clean
// finds exactly it; a row an administrator has since edited is no longer
// found, because saving moves updated_at.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED_STAMP = "2000-01-01T00:00:00Z";

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const chance = (p) => Math.random() < p;
// Mostly 3s and 4s, some 2s, the odd 1.
const score = () => pick([1, 2, 2, 3, 3, 3, 3, 4, 4, 4]);

const COMMENTS = {
  1: ["Did not get to the main point", "Needs a lot more preparation", "Missed the customer's stated problem"],
  2: ["Light on discovery and detail", "Rushed the close", "Good start, lost the thread halfway"],
  3: ["Good pacing and level of detail", "Solid, with room to tighten the story", "Clear and well organised"],
  4: ["Confirmed authority and tied off loose ends", "Excellent use of the customer's own words", "Confident, prepared and adaptive"],
};
const POSITIVE = [
  "Asked great open-ended questions and mirrored the customer's language.",
  "High energy and hungry to learn; took feedback and applied it right away.",
  "Strong rapport and a clear, structured story.",
  "Handled objections calmly and kept the conversation moving.",
];
const CONSTRUCTIVE = [
  "Slow down in discovery and dig one level deeper before moving on.",
  "Tighten the opening so the value is clear in the first minute.",
  "Practice the close; ask for the next step directly.",
  "Leaned on slides; try leading with the customer's problem.",
];
const NOTES = ["", "", "Attended every session.", "Asked to be paired with a mentor.", "Missed the first morning; caught up on the recording."];

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
    const s = await client.query("delete from evals_submissions where updated_at = $1", [SEED_STAMP]);
    const r = await client.query("delete from bootcamp_class_reviews where updated_at = $1", [SEED_STAMP]);
    console.log(`${db[0].name}: removed ${s.rowCount} seeded submissions and ${r.rowCount} seeded reviews.`);
    process.exit(0);
  }

  const {
    rows: [bootcamp],
  } = await client.query(
    `select id, start_date from bootcamps where status = 'active'
     union all (select id, start_date from bootcamps where status = 'complete' order by start_date desc limit 1)
     limit 1`,
  );
  if (!bootcamp) {
    console.error("No active or finished bootcamp to seed into.");
    process.exit(1);
  }

  const { rows: people } = await client.query(`
    select r.email, (select e.track from employees e where e.email = r.email order by e.active desc limit 1) as track
      from (select distinct lower(email) as email from intake_responses where form = 'bootcamp') r`);

  const { rows: assessments } = await client.query(`
    select a.id, a.name, a.audience, a.built_in,
           coalesce(json_agg(json_build_object('id', c.id, 'name', c.name) order by c.position) filter (where c.id is not null), '[]') as criteria
      from evals_assessments a
      left join evals_assessment_criteria c on c.assessment_id = a.id and c.retired_at is null
     where a.stage = 'bootcamp' and (a.active or a.built_in = 'participation') and a.name <> 'Exams'
     group by a.id`);

  let submissions = 0;
  let reviews = 0;
  await client.query("begin");
  for (const person of people) {
    const audience = person.track === "engineer" ? "engineer" : "sales";
    for (const a of assessments) {
      if (a.audience !== "both" && a.audience !== audience) continue;
      // Participation is a mark, not a criteria form: it carries only its average.
      const scored = a.built_in ? [] : a.criteria.map((c) => ({ ...c, score: score() }));
      const average = scored.length ? scored.reduce((n, c) => n + c.score, 0) / scored.length : score();
      const {
        rows: [made],
      } = await client.query(
        `insert into evals_submissions (bootcamp_id, assessment_id, attendee_email, assessment_name, average_score, positive_feedback, constructive_feedback, submitted_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, now(), $8)
         on conflict do nothing returning id`,
        [bootcamp.id, a.id, person.email, a.name, average, chance(0.7) ? pick(POSITIVE) : "", chance(0.7) ? pick(CONSTRUCTIVE) : "", SEED_STAMP],
      );
      if (!made) continue;
      submissions++;
      for (const c of scored) {
        await client.query(
          `insert into evals_submission_scores (submission_id, criterion_id, criterion_name, score, comment) values ($1, $2, $3, $4, $5)`,
          [made.id, c.id, c.name, c.score, chance(0.8) ? pick(COMMENTS[c.score]) : ""],
        );
      }
    }

    const exam = () => Math.round(70 + Math.random() * 30);
    const r = await client.query(
      `insert into bootcamp_class_reviews (bootcamp_id, stage, attendee_email, positive_feedback, constructive_feedback, other_notes, entrance_exam, exit_exam, updated_at)
       values ($1, 'bootcamp', $2, $3, $4, $5, $6, $7, $8) on conflict do nothing`,
      [bootcamp.id, person.email, pick(POSITIVE), pick(CONSTRUCTIVE), pick(NOTES), exam(), exam(), SEED_STAMP],
    );
    reviews += r.rowCount ?? 0;
  }
  await client.query("commit");
  console.log(`${db[0].name}: ${people.length} people at the ${bootcamp.start_date.toISOString().slice(0, 10)} bootcamp; added ${submissions} submissions and ${reviews} reviews.`);
} catch (err) {
  await client.query("rollback").catch(() => undefined);
  throw err;
} finally {
  await client.end();
}
