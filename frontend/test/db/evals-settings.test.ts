/**
 * eVals settings against a real database: the title lists' one-list-per-title
 * rule (a case-insensitive unique index), the bootcamp history upsert, and the
 * HiBob sync that replaces every employee at once and logs each run.
 *
 * HiBob itself is replaced by a stubbed `fetch`, and its credentials by
 * environment variables. A sync empties `employees`, so the table is saved
 * before and put back after — the scratch database may hold someone's sync.
 * Titles and history rows this suite writes carry `TEST_PREFIX` or the test
 * email domain, sync runs are remembered by id, and cleanup deletes by those
 * alone.
 */

import "../support/test-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, like } from "drizzle-orm";

process.env.AUTH_SECRET ||= "evals-settings-test-secret-evals-settings";

import { db } from "@/db";
import { bootcampHistory, employees, evalsTitles, EXEMPT_DATE, hibobSyncRuns } from "@/db/schema";
import {
  createHistory,
  historyInputSchema,
  historyPatchSchema,
  importHistory,
  listHistory,
  updateHistory,
} from "@/lib/evals/bootcamp-history";
import { hibobServiceUser, listHibobSyncRuns, syncHibobEmployees } from "@/lib/evals/hibob";
import { loadRoster } from "@/lib/evals/roster";
import { addTitles, deleteTitle, listTitles, updateTitle } from "@/lib/evals/titles";
import { HIBOB_SYNC_LIST, TITLE_LIST, type TitleSort } from "@/lib/list-specs";
import type { ListQuery } from "@/lib/paging";
import { TEST_EMAIL_DOMAIN, TEST_PREFIX } from "../support/db";
import { PERSONAS } from "../support/access";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("evals");
const T = (title: string) => `${TEST_PREFIX}${title}`;

/** This file's titles, as the first page of a search for the prefix finds them. */
async function myTitles(list?: "sales" | "engineer" | "ignored", sort: Partial<ListQuery<TitleSort>> = {}) {
  return (await listTitles({ ...TITLE_LIST, q: TEST_PREFIX, page: 1, list, ...sort })).rows;
}
const email = (name: string) => `${name}@${TEST_EMAIL_DOMAIN}`;

let admin: TestUser;
let savedEmployees: (typeof employees.$inferSelect)[];
const realFetch = globalThis.fetch;
const realEnv = { id: process.env.HIBOB_SERVICE_USER_ID, token: process.env.HIBOB_TOKEN };
/** Every sync run this suite made, so cleanup touches no one else's. */
const runIds: string[] = [];

async function clearOwnRows() {
  await db.delete(evalsTitles).where(like(evalsTitles.title, `${TEST_PREFIX}%`));
  await db.delete(bootcampHistory).where(like(bootcampHistory.email, `%@${TEST_EMAIL_DOMAIN}`));
}

before(async () => {
  await scope.setUp();
  await clearOwnRows();
  admin = await scope.createUser("admin", PERSONAS.evalsAdmin);
  savedEmployees = await db.select().from(employees);
});

after(async () => {
  globalThis.fetch = realFetch;
  restoreEnv();
  await clearOwnRows();
  if (runIds.length > 0) await db.delete(hibobSyncRuns).where(inArray(hibobSyncRuns.id, runIds));
  await db.transaction(async (tx) => {
    await tx.delete(employees);
    for (let i = 0; i < savedEmployees.length; i += 500) {
      await tx.insert(employees).values(savedEmployees.slice(i, i + 500));
    }
  });
  await scope.tearDown();
});

function restoreEnv() {
  for (const [name, value] of [
    ["HIBOB_SERVICE_USER_ID", realEnv.id],
    ["HIBOB_TOKEN", realEnv.token],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

afterEach(() => {
  globalThis.fetch = realFetch;
  restoreEnv();
});

describe("title lists", () => {
  test("a title sits on one list, whatever its case", async () => {
    const first = await addTitles(admin.id, "sales", [T("Account Executive"), T("SDR")]);
    assert.deepEqual(first.added.sort(), [T("Account Executive"), T("SDR")]);

    const again = await addTitles(admin.id, "engineer", [T("account  EXECUTIVE"), T("Sales Engineer")]);
    assert.deepEqual(again.added, [T("Sales Engineer")]);
    assert.deepEqual(again.existing, [{ title: T("Account Executive"), list: "sales" }]);

    const mine = await myTitles();
    assert.deepEqual(
      mine.map((t) => [t.title, t.list, t.addedBy]),
      [
        [T("Account Executive"), "sales", "admin"],
        [T("Sales Engineer"), "engineer", "admin"],
        [T("SDR"), "sales", "admin"],
      ],
    );
  });

  test("a page holds one list's titles, sorted as asked", async () => {
    assert.deepEqual(
      (await myTitles("sales", { dir: "desc" })).map((t) => t.title),
      [T("SDR"), T("Account Executive")],
    );
    assert.deepEqual((await myTitles("ignored")).map((t) => t.title), []);
    const later = await listTitles({ ...TITLE_LIST, q: TEST_PREFIX, page: 2 });
    assert.deepEqual([later.rows.length, later.hasMore], [0, false]);
  });

  test("renaming onto another title is refused, naming its list; moving lists works", async () => {
    const titles = await myTitles();
    const sdr = titles.find((t) => t.title === T("SDR"))!;

    assert.deepEqual(await updateTitle(sdr.id, { title: T("sales engineer") }), {
      ok: false,
      error: "duplicate",
      list: "engineer",
    });
    assert.deepEqual(await updateTitle(sdr.id, { title: `  ${T("SDR")}  II `, list: "ignored" }), { ok: true });

    const moved = (await myTitles()).find((t) => t.id === sdr.id)!;
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
          `${email("pat")},46182.125,4,"{""Score-Exams"":4.5}"\n` +
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
    assert.equal(pat.btcScore, 4);
    assert.deepEqual(pat.btcIndividualScores, { "Score-Exams": 4.5 });
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
      await updateHistory(admin.id, row.id, historyPatchSchema.parse({ intDate: EXEMPT_DATE, btcScore: 2 })),
      { ok: true },
    );
    const after = (await listHistory()).find((h) => h.id === row.id)!;
    assert.equal(after.intDate, EXEMPT_DATE);
    assert.equal(after.btcScore, 2);
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
    for (const btcScore of [0, 5, 3.5]) {
      assert.equal(historyInputSchema.safeParse({ ...blank, email: email("a"), btcScore }).success, false);
    }
  });
});

describe("HiBob sync", () => {
  const person = (id: string, name: string, manager: string, title = "") => ({
    id,
    email: email(name),
    fullName: name,
    work: { reportsTo: { email: manager && email(manager), displayName: manager }, startDate: "2025-06-02" },
    humanReadable: { work: { title } },
  });

  function configure() {
    process.env.HIBOB_SERVICE_USER_ID = "SERVICE-TEST";
    process.env.HIBOB_TOKEN = "test-token";
  }

  function stubHibob(status: number, people: unknown[] = []) {
    const calls: { authorization: string | null; body: unknown }[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      calls.push({
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ employees: people }), { status });
    }) as typeof fetch;
    return calls;
  }

  async function sync(trigger: "manual" | "schedule" = "manual") {
    const result = await syncHibobEmployees(trigger, trigger === "manual" ? admin.id : null);
    if (result.runId) runIds.push(result.runId);
    return result;
  }

  async function run(id: string | null) {
    assert.ok(id);
    return (await listHibobSyncRuns({ ...HIBOB_SYNC_LIST, q: "", page: 1 })).rows.find((r) => r.id === id)!;
  }

  test("without credentials nothing is asked of HiBob, and the run says why", async () => {
    delete process.env.HIBOB_SERVICE_USER_ID;
    delete process.env.HIBOB_TOKEN;
    const calls = stubHibob(200);
    assert.equal(hibobServiceUser(), null);

    const result = await sync("schedule");
    assert.equal(!result.ok && result.error, "not_configured");
    assert.equal(calls.length, 0);
    const logged = await run(result.runId);
    assert.equal(logged.status, "failed");
    assert.equal(logged.trigger, "schedule");
    assert.match(logged.error ?? "", /hibob_userid and hibob_token/);
  });

  test("replaces every employee, logs the count, and the roster walks up to the root", async () => {
    configure();
    const calls = stubHibob(200, [
      person("1", "root", "ceo"),
      person("2", "vp", "root", "Director"),
      person("3", "ae", "vp", `${T("Account Executive")}`),
      person("4", "outsider", "ceo", "Director"),
      { email: "no-id@x.com" },
    ]);
    const first = await sync();
    assert.ok(first.ok, JSON.stringify(first));
    assert.deepEqual([first.count, first.skipped], [4, 1]);
    // What fetchHibobToEmployees asked for: active people, labels alongside ids.
    assert.deepEqual(calls[0]!.body, { showInactive: false, humanReadable: "APPEND" });
    assert.equal(calls[0]!.authorization, `Basic ${Buffer.from("SERVICE-TEST:test-token").toString("base64")}`);

    stubHibob(200, [person("1", "root", ""), person("3", "ae", "root", T("Account Executive"))]);
    const second = await sync();
    assert.ok(second.ok);
    assert.equal(second.count, 2);
    assert.equal((await db.select().from(employees)).length, 2);

    const logged = await run(second.runId);
    assert.equal(logged.status, "succeeded");
    assert.equal(logged.employeeCount, 2);
    assert.equal(logged.triggeredBy, "admin");
    assert.ok(logged.finishedAt);

    await importHistory(admin.id, new File([`email,BTCDate\n${email("ae")},2026-03-01\n`], "h.csv"));
    const roster = await loadRoster(email("root"));
    assert.equal(roster.rootFound, true);
    assert.deepEqual(
      roster.people.map((p) => [p.email, p.depth, p.list, p.btcDate]),
      [[email("ae"), 1, "sales", "2026-03-01"]],
    );
  });

  test("a failed sync keeps the last one and records why", async () => {
    configure();
    stubHibob(500);
    const failed = await sync();
    assert.equal(!failed.ok && failed.error, "bad_response");
    assert.equal((await db.select().from(employees)).length, 2);
    assert.match((await run(failed.runId)).error ?? "", /HiBob answered 500/);

    stubHibob(401);
    const rejected = await sync();
    assert.equal(!rejected.ok && rejected.error, "rejected");
  });

  test("one sync at a time, unless the running one was cut off long ago", async () => {
    configure();
    stubHibob(200, [person("1", "root", "")]);
    const [running] = await db
      .insert(hibobSyncRuns)
      .values({ trigger: "schedule" })
      .returning({ id: hibobSyncRuns.id });
    runIds.push(running!.id);

    const refused = await sync();
    assert.deepEqual(refused, { ok: false, runId: null, error: "already_running" });

    await db
      .update(hibobSyncRuns)
      .set({ startedAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(hibobSyncRuns.id, running!.id));
    const after = await sync();
    assert.ok(after.ok, JSON.stringify(after));
    const cutOff = await run(running!.id);
    assert.equal(cutOff.status, "failed");
    assert.match(cutOff.error ?? "", /Did not finish/);
  });
});
