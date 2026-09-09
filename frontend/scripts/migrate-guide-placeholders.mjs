/*
 * One-time sweep: `?project` → `{{project}}` in authored guide content.
 *
 * The renderer only fills `{{name}}` (see `src/lib/guide-variables.ts`), so
 * guides written against the old JavaScript-replace syntax show their
 * placeholders verbatim to readers until this has run.
 *
 *   node scripts/migrate-guide-placeholders.mjs           # dry run, prints every change
 *   node scripts/migrate-guide-placeholders.mjs --apply   # writes, after dumping a backup
 *
 * Two rules keep it from breaking anything it does not understand:
 *
 *   * Only the ten known variable names are rewritten. Anything else beginning
 *     with `?` is reported and left exactly as it was.
 *   * A name is only a placeholder when a word character does not follow it.
 *     `?projectIdentifier=` and `?accountId=` are Harness URL query strings and
 *     have nothing to do with this; matching `?project` inside one would corrupt
 *     a link that currently works. Longest name first, so `?projectUrl` is not
 *     read as `?project` with "Url" left dangling after it.
 */

import { writeFileSync } from "node:fs";
import { Client } from "pg";

const NAMES = [
  "project",
  "org",
  "account",
  "projectUrl",
  "orgUrl",
  "email",
  "workshop",
  "gcpProject",
  "awsAccount",
  "awsRegion",
];

const PLACEHOLDER = new RegExp(
  `\\?(${[...NAMES].sort((a, b) => b.length - a.length).join("|")})(?![A-Za-z0-9_])`,
  "g",
);

/** Anything `?word`-shaped, so what is left behind can be reported. */
const ANY_TOKEN = /\?[A-Za-z][A-Za-z0-9_]*/g;

const TARGETS = [
  { table: "lab_guides", fields: ["title", "summary", "body"] },
  { table: "lab_workshops", fields: ["title", "summary"] },
];

const apply = process.argv.includes("--apply");

const context = (text, index, length) =>
  text
    .slice(Math.max(0, index - 40), index + length + 30)
    .replace(/\n/g, "⏎");

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const database = (await client.query("select current_database() as name"))
  .rows[0].name;
console.log(`${apply ? "APPLY" : "DRY RUN"} against ${database}\n`);

const changes = [];
const leftAlone = new Map();

for (const { table, fields } of TARGETS) {
  const { rows } = await client.query(
    `select id, slug, ${fields.join(", ")} from ${table} order by slug`,
  );

  for (const row of rows) {
    const updates = {};

    for (const field of fields) {
      const before = row[field] ?? "";
      const after = before.replace(PLACEHOLDER, (_, name) => `{{${name}}}`);
      if (after !== before) updates[field] = { before, after };

      // What this sweep did not claim, so it can be looked at by hand.
      for (const m of after.matchAll(ANY_TOKEN)) {
        const key = m[0];
        const seen = leftAlone.get(key) ?? { count: 0, where: [] };
        seen.count += 1;
        if (seen.where.length < 3)
          seen.where.push(`${table}/${row.slug} [${field}] …${context(after, m.index, m[0].length)}…`);
        leftAlone.set(key, seen);
      }
    }

    if (Object.keys(updates).length > 0)
      changes.push({ table, id: row.id, slug: row.slug, updates });
  }
}

if (changes.length === 0) {
  console.log("Nothing to change — no `?name` placeholders in any known field.");
} else {
  let total = 0;
  for (const change of changes) {
    console.log(`${change.table}/${change.slug}`);
    for (const [field, { before, after }] of Object.entries(change.updates)) {
      const hits = [...before.matchAll(PLACEHOLDER)];
      total += hits.length;
      console.log(`  [${field}] ${hits.length} placeholder${hits.length === 1 ? "" : "s"}`);
      for (const m of hits.slice(0, 8))
        console.log(`     ${m[0]} → {{${m[1]}}}   …${context(before, m.index, m[0].length)}…`);
      if (hits.length > 8) console.log(`     …and ${hits.length - 8} more`);
      void after;
    }
  }
  console.log(`\n${total} placeholder(s) across ${changes.length} row(s).`);
}

if (leftAlone.size > 0) {
  console.log("\nLeft as it was (not a known variable, or glued to a word):");
  for (const [token, seen] of [...leftAlone].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${token} ×${seen.count}`);
    for (const where of seen.where) console.log(`     ${where}`);
  }
}

if (apply && changes.length > 0) {
  // The old text, in full, before a single row is touched.
  const backup = `/tmp/guide-placeholders-backup-${Date.now()}.json`;
  writeFileSync(
    backup,
    JSON.stringify({ database, when: new Date().toISOString(), changes }, null, 2),
  );
  console.log(`\nBackup of the previous text: ${backup}`);

  await client.query("begin");
  try {
    for (const change of changes) {
      const fields = Object.keys(change.updates);
      const sets = fields.map((field, i) => `${field} = $${i + 2}`).join(", ");
      const values = fields.map((field) => change.updates[field].after);
      await client.query(
        `update ${change.table} set ${sets} where id = $1`,
        [change.id, ...values],
      );
    }
    await client.query("commit");
    console.log(`Committed ${changes.length} row update(s).`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  }

  // Read back, rather than trusting the write.
  for (const { table, fields } of TARGETS) {
    const { rows } = await client.query(
      `select slug, ${fields.join(", ")} from ${table}`,
    );
    const remaining = rows.flatMap((row) =>
      fields.flatMap((field) =>
        [...(row[field] ?? "").matchAll(PLACEHOLDER)].map(() => `${table}/${row.slug}.${field}`),
      ),
    );
    console.log(
      `${table}: ${remaining.length === 0 ? "no `?name` placeholders remain" : `STILL PRESENT in ${[...new Set(remaining)].join(", ")}`}`,
    );
  }
} else if (!apply && changes.length > 0) {
  console.log("\nNothing written. Re-run with --apply.");
}

await client.end();
