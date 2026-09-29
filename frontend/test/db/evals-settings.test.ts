/**
 * eVals settings against a real database: the title lists' one-list-per-title
 * rule (a case-insensitive unique index), the bootcamp history upsert, and the
 * HiBob import that replaces every employee at once.
 *
 * HiBob itself is replaced by a stubbed `fetch`. The import empties
 * `hibob_employees` and rewrites the connection row, so both tables are saved
 * before and put back after — the scratch database may hold someone's import.
 * Titles and history rows this suite writes carry `TEST_PREFIX` or the test
 * email domain, and cleanup deletes by those alone.
 */

import "../support/test-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { like } from "drizzle-orm";

process.env.AUTH_SECRET ||= "evals-settings-test-secret-evals-settings";

import { db } from "@/db";
import { bootcampHistory, evalsTitles, EXEMPT_DATE, hibobConnection, hibobEmployees } from "@/db/schema";
import {
  createHistory,
  historyInputSchema,
  historyPatchSchema,
  importHistory,
  listHistory,
  updateHistory,
} from "@/lib/evals/bootcamp-history";
import {
  getHibobConnection,
  importHibobEmployees,
  saveHibobConnection,
} from "@/lib/evals/hibob";
import { loadRoster } from "@/lib/evals/roster";
import { addTitles, deleteTitle, listTitles, updateTitle } from "@/lib/evals/titles";
import { TEST_EMAIL_DOMAIN, TEST_PREFIX } from "../support/db";
import { PERSONAS } from "../support/access";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("evals");
const T = (title: string) => `${TEST_PREFIX}${title}`;
const email = (name: string) => `${name}@${TEST_EMAIL_DOMAIN}`;

let admin: TestUser;
let savedEmployees: (typeof hibobEmployees.$inferSelect)[];
let savedConnection: (typeof hibobConnection.$inferSelect)[];
const realFetch = globalThis.fetch;

async function clearOwnRows() {
  await db.delete(evalsTitles).where(like(evalsTitles.title, `${TEST_PREFIX}%`));
  await db.delete(bootcampHistory).where(like(bootcampHistory.email, `%@${TEST_EMAIL_DOMAIN}`));
}

before(async () => {
  await scope.setUp();
  await clearOwnRows();
  admin = await scope.createUser("admin", PERSONAS.evalsAdmin);
  savedEmployees = await db.select().from(hibobEmployees);
  savedConnection = await db.select().from(hibobConnection);
});

after(async () => {
  globalThis.fetch = realFetch;
  await clearOwnRows();
  await db.transaction(async (tx) => {
    await tx.delete(hibobEmployees);
    await tx.delete(hibobConnection);
    for (let i = 0; i < savedEmployees.length; i += 500) {
      await tx.insert(hibobEmployees).values(savedEmployees.slice(i, i + 500));
    }
    if (savedConnection.length > 0) {
      // The admin who saved it is this suite's, and is about to be deleted.
      await tx.insert(hibobConnection).values(savedConnection);
    }
  });
  await scope.tearDown();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("title lists", () => {
  test("a title sits on one list, whatever its case", async () => {
    const first = await addTitles(admin.id, "sales", [T("Account Executive"), T("SDR")]);
    assert.deepEqual(first.added.sort(), [T("Account Executive"), T("SDR")]);

    const again = await addTitles(admin.id, "engineer", [T("account  EXECUTIVE"), T("Sales Engineer")]);
    assert.deepEqual(again.added, [T("Sales Engineer")]);
    assert.deepEqual(again.existing, [{ title: T("Account Executive"), list: "sales" }]);

    const mine = (await listTitles()).filter((t) => t.title.startsWith(TEST_PREFIX));
    assert.deepEqual(
      mine.map((t) => [t.title, t.list, t.addedBy]),
      [
        [T("Account Executive"), "sales", "admin"],
        [T("Sales Engineer"), "engineer", "admin"],
        [T("SDR"), "sales", "admin"],
      ],
    );
  });

  test("renaming onto another title is refused, naming its list; moving lists works", async () => {
    const titles = (await listTitles()).filter((t) => t.title.startsWith(TEST_PREFIX));
    const sdr = titles.find((t) => t.title === T("SDR"))!;

    assert.deepEqual(await updateTitle(sdr.id, { title: T("sales engineer") }), {
      ok: false,
      error: "duplicate",
      list: "engineer",
    });
    assert.deepEqual(await updateTitle(sdr.id, { title: `  ${T("SDR")}  II `, list: "ignored" }), { ok: true });

    const moved = (await listTitles()).find((t) => t.id === sdr.id)!;
    assert.equal(moved.title, `${T("SDR")} II`);
    assert.equal(moved.list, "ignored");
  });

  test("a missing title is not found", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    assert.deepEqual(await updateTitle(missing, { title: "x" }), { ok: false, error: "not_found" });
    assert.deepEqual(await deleteTitle(missing), { ok: false, error: "not_found" });
  });
});

describe("bootcamp history import", () => {
  const csv = (text: string) => new File([text], "Bootcamp_History.csv", { type: "text/csv" });

  test("adds new people, then updates them by email and leaves others alone", async () => {
    const first = await importHistory(
      admin.id,
      csv(
        "email,BTCDate,BTCScore,BTCIndividualScores\n" +
          `${email("pat")},46182.125,4.5,"{""Score-Exams"":4}"\n` +
          `${email("lee")},2000-01-01,,\n`,
      ),
    );
    assert.ok(first.ok, JSON.stringify(first));
    assert.deepEqual(first.summary, { added: 2, updated: 0, problems: [], ignoredColumns: [] });

    const second = await importHistory(
      admin.id,
      csv(`email,INTDate,INTScore\n${email("PAT")},2026-08-04,3\n${email("sam")},,\n`),
    );
    assert.ok(second.ok);
    assert.equal(second.summary.added, 1);
    assert.equal(second.summary.updated, 1);

    const mine = (await listHistory()).filter((h) => h.email.endsWith(`@${TEST_EMAIL_DOMAIN}`));
    const pat = mine.find((h) => h.email === email("pat"))!;
    // An INT-only sheet leaves the BTC results that were already stored.
    assert.equal(pat.btcDate, "2026-06-09");
    assert.equal(pat.btcScore, 4.5);
    assert.deepEqual(pat.btcIndividualScores, { "Score-Exams": 4 });
    assert.equal(pat.intDate, "2026-08-04");
    assert.equal(pat.intScore, 3);
    assert.equal(mine.find((h) => h.email === email("lee"))!.btcDate, "2000-01-01");
    assert.equal(mine.length, 3);
  });

  test("a blank cell in a sheet's column clears that value", async () => {
    const result = await importHistory(admin.id, csv(`email,BTCScore\n${email("pat")},\n`));
    assert.ok(result.ok);
    const pat = (await listHistory()).find((h) => h.email === email("pat"))!;
    assert.equal(pat.btcScore, null);
    assert.equal(pat.btcDate, "2026-06-09");
  });

  test("refuses an empty upload and a sheet with no email column", async () => {
    assert.deepEqual(await importHistory(admin.id, null), { ok: false, error: "no_file" });
    assert.deepEqual(await importHistory(admin.id, csv("name\nPat\n")), { ok: false, error: "no_email_column" });
  });
});

describe("bootcamp history edits", () => {
  const blank = { btcDate: null, intDate: null, btcScore: null, intScore: null };
  const input = (v: unknown) => historyInputSchema.parse(v);

  test("adds a person once, whatever the email's case", async () => {
    const added = await createHistory(admin.id, input({ ...blank, email: ` ${email("New.Hire")} ` }));
    assert.ok(added.ok);
    const row = (await listHistory()).find((h) => h.id === added.id)!;
    assert.equal(row.email, email("new.hire"));

    assert.deepEqual(await createHistory(admin.id, input({ ...blank, email: email("NEW.HIRE") })), {
      ok: false,
      error: "duplicate",
    });
  });

  test("an edit changes only what it names, and keeps grading's individual scores", async () => {
    await importHistory(
      admin.id,
      new File([`email,BTCScore,BTCIndividualScores\n${email("edited")},3,"{""Score-Lab"":3}"\n`], "h.csv"),
    );
    const row = (await listHistory()).find((h) => h.email === email("edited"))!;

    assert.deepEqual(
      await updateHistory(admin.id, row.id, historyPatchSchema.parse({ intDate: EXEMPT_DATE, btcScore: 3.5 })),
      { ok: true },
    );
    const after = (await listHistory()).find((h) => h.id === row.id)!;
    assert.equal(after.intDate, EXEMPT_DATE);
    assert.equal(after.btcScore, 3.5);
    assert.deepEqual(after.btcIndividualScores, { "Score-Lab": 3 });
  });

  test("an edit onto someone else's email is refused, and a missing row is not found", async () => {
    const row = (await listHistory()).find((h) => h.email === email("edited"))!;
    assert.deepEqual(await updateHistory(admin.id, row.id, { email: email("new.hire") }), {
      ok: false,
      error: "duplicate",
    });
    assert.deepEqual(await updateHistory(admin.id, "00000000-0000-4000-8000-000000000000", { intScore: 1 }), {
      ok: false,
      error: "not_found",
    });
  });

  test("the form's values are checked", () => {
    assert.equal(historyInputSchema.safeParse({ ...blank, email: "nope" }).success, false);
    assert.equal(historyInputSchema.safeParse({ ...blank, email: email("a"), btcDate: "2026-02-30" }).success, false);
    assert.equal(historyInputSchema.safeParse({ ...blank, email: email("a"), intScore: "4" }).success, false);
  });
});

describe("HiBob import", () => {
  const person = (id: string, name: string, manager: string, title = "") => ({
    id,
    email: email(name),
    fullName: name,
    work: { reportsTo: { email: manager && email(manager), displayName: manager }, startDate: "2025-06-02" },
    humanReadable: { work: { title } },
  });

  function stubHibob(status: number, employees: unknown[] = []) {
    const calls: { fields?: string[] }[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ employees }), { status });
    }) as typeof fetch;
    return calls;
  }

  test("refuses credentials HiBob turns down, and saves ones it accepts", async () => {
    stubHibob(401);
    const refused = await saveHibobConnection(admin.id, { serviceUserId: "SERVICE-X", token: "bad-token" });
    assert.equal(refused.ok, false);
    assert.equal(!refused.ok && refused.error, "rejected");

    const calls = stubHibob(200);
    assert.deepEqual(await saveHibobConnection(admin.id, { serviceUserId: "SERVICE-X", token: "good-token-1234" }), {
      ok: true,
    });
    // The check asks for one field, not the ~10 MB of everyone.
    assert.deepEqual(calls[0]!.fields, ["/root/id"]);
    const saved = await getHibobConnection();
    assert.equal(saved?.serviceUserId, "SERVICE-X");
    assert.equal(saved?.tail, "1234");
  });

  test("replaces every employee, and the roster walks up to the root", async () => {
    stubHibob(200, [
      person("1", "root", "ceo"),
      person("2", "vp", "root", "Director"),
      person("3", "ae", "vp", `${T("Account Executive")}`),
      person("4", "outsider", "ceo", "Director"),
      { email: "no-id@x.com" },
    ]);
    const result = await importHibobEmployees(admin.id);
    assert.deepEqual(result, { ok: true, count: 4, skipped: 1 });

    stubHibob(200, [person("1", "root", ""), person("3", "ae", "root", T("Account Executive"))]);
    assert.deepEqual(await importHibobEmployees(admin.id), { ok: true, count: 2, skipped: 0 });
    assert.equal((await db.select().from(hibobEmployees)).length, 2);

    await importHistory(admin.id, new File([`email,BTCDate\n${email("ae")},2026-03-01\n`], "h.csv"));
    const roster = await loadRoster(email("root"));
    assert.equal(roster.rootFound, true);
    assert.deepEqual(
      roster.people.map((p) => [p.email, p.depth, p.list, p.btcDate]),
      [[email("ae"), 1, "sales", "2026-03-01"]],
    );
    assert.equal((await getHibobConnection())?.lastImportCount, 2);
  });

  test("a failed import keeps the last one and records why", async () => {
    stubHibob(500);
    const result = await importHibobEmployees(admin.id);
    assert.equal(!result.ok && result.error, "bad_response");
    assert.equal((await db.select().from(hibobEmployees)).length, 2);
    assert.match((await getHibobConnection())?.lastImportError ?? "", /HiBob answered 500/);
  });
});
