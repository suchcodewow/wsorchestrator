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
import {
  bootcampHistory,
  bootcamps,
  employees,
  employeeTrackOverrides,
  EVALS_SETTINGS_KEYS,
  evalsSettings,
  evalsSlackContacts,
  evalsTitles,
  EXEMPT_DATE,
  hibobSyncRuns,
} from "@/db/schema";
import {
  createHistory,
  deleteHistory,
  getHistoryDetail,
  historyCounts,
  historyInputSchema,
  historyPatchSchema,
  importHistory,
  listHistory,
  listHistoryPage,
  updateHistory,
} from "@/lib/evals/bootcamp-history";
import { hibobServiceUser, listHibobSyncRuns, syncHibobEmployees } from "@/lib/evals/hibob";
import { currentCohortSummary, listCurrentCohort, type CandidateStage } from "@/lib/evals/current-cohort";
import { listOrganizationMembers, loadRoster } from "@/lib/evals/roster";
import {
  DEFAULT_CANDIDATE_CUTOFFS,
  DEFAULT_DEFERRAL_DAYS,
  getCandidateCutoffs,
  getDeferralDays,
  setCandidateCutoffs,
  setDeferralDays,
} from "@/lib/evals/settings";
import { addSlackContact, deleteSlackContact, listSlackContacts } from "@/lib/evals/slack-contacts";
import { addTitles, deleteTitle, listTitles, updateTitle } from "@/lib/evals/titles";
import { retrackOrg, setTrack, sortUndecidedTitle } from "@/lib/evals/tracks";
import {
  BOOTCAMP_HISTORY_LIST,
  BOOTCAMP_LIST,
  CURRENT_COHORT_LIST,
  HIBOB_SYNC_LIST,
  ORGANIZATION_LIST,
  SLACK_CONTACT_LIST,
  TITLE_LIST,
  type BootcampHistorySort,
  type HistoryStatus,
  type TitleSort,
} from "@/lib/list-specs";
import {
  activeBootcamp,
  bootcampInputSchema,
  createBootcamp,
  deleteBootcamp,
  listBootcamps,
  updateBootcamp,
} from "@/lib/scheduler/bootcamps";
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
  await db.delete(evalsSlackContacts).where(like(evalsSlackContacts.email, `%@${TEST_EMAIL_DOMAIN}`));
  await db.delete(employees).where(like(employees.id, `${TEST_PREFIX}%`));
  await db.delete(employeeTrackOverrides).where(like(employeeTrackOverrides.email, `%@${TEST_EMAIL_DOMAIN}`));
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

describe("Additional Slack Contacts", () => {
  const mine = async () =>
    (await listSlackContacts({ ...SLACK_CONTACT_LIST, q: TEST_EMAIL_DOMAIN, page: 1 })).rows.map((c) => [
      c.email,
      c.fullName,
      c.addedBy,
    ]);

  test("an employee is named as the employee list has them; anyone else by email alone", async () => {
    await db.insert(employees).values({ id: `${TEST_PREFIX}slack`, email: email("s-pat"), fullName: "Pat Slack", raw: {} });

    const pat = await addSlackContact(admin.id, { email: `  ${email("S-Pat").toUpperCase()} ` });
    assert.ok(pat.ok);
    assert.deepEqual([pat.contact.email, pat.contact.fullName], [email("s-pat"), "Pat Slack"]);
    assert.ok((await addSlackContact(admin.id, { email: email("s-outside") })).ok);

    // By name, and by email for someone without one.
    assert.deepEqual(await mine(), [
      [email("s-pat"), "Pat Slack", "admin"],
      [email("s-outside"), "", "admin"],
    ]);
  });

  test("each email once, and nothing that isn't one", async () => {
    assert.deepEqual(await addSlackContact(admin.id, { email: email("s-pat") }), { ok: false, error: "duplicate" });
    assert.deepEqual(await addSlackContact(admin.id, { email: "Pat Slack" }), { ok: false, error: "invalid" });
  });

  test("removing one leaves the rest", async () => {
    const { rows } = await listSlackContacts({ ...SLACK_CONTACT_LIST, q: email("s-outside"), page: 1 });
    assert.deepEqual(await deleteSlackContact(rows[0]!.id), { ok: true, email: email("s-outside") });
    assert.deepEqual(await deleteSlackContact(rows[0]!.id), { ok: false, error: "not_found" });
    assert.deepEqual(await mine(), [[email("s-pat"), "Pat Slack", "admin"]]);
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

describe("bootcamp history page", () => {
  const page = (q: string, sort: BootcampHistorySort = "fullName", status: HistoryStatus | null = null) =>
    listHistoryPage({ ...BOOTCAMP_HISTORY_LIST, sort, dir: "asc", q, page: 1 }, status);

  test("lists each person by the employee list's name, sinking those it lacks, and finds them by either", async () => {
    await db.insert(employees).values({
      id: `${TEST_PREFIX}history`,
      email: email("h-ann"),
      fullName: "Ann History",
      title: "Solutions Engineer",
      raw: {},
    });
    const blank = { btcDate: null, intDate: null, btcScore: null, intScore: null };
    assert.ok((await createHistory(admin.id, { ...blank, email: email("h-zed"), intScore: 2 })).ok);
    assert.ok((await createHistory(admin.id, { ...blank, email: email("h-ann"), btcDate: "2026-03-02", btcScore: 3.3 })).ok);

    const rows = (r: Awaited<ReturnType<typeof page>>) => r.rows.map((h) => [h.email, h.fullName]);
    assert.deepEqual(rows(await page("h-")), [
      [email("h-ann"), "Ann History"],
      [email("h-zed"), null],
    ]);
    assert.deepEqual(rows(await page("ann hist")), [[email("h-ann"), "Ann History"]]);
  });

  test("lists the newest bootcamp first by default, with no date last", async () => {
    const newest = await listHistoryPage({ ...BOOTCAMP_HISTORY_LIST, q: "h-", page: 1 });
    assert.equal(BOOTCAMP_HISTORY_LIST.sort, "btcDate");
    assert.deepEqual(
      newest.rows.map((h) => [h.email, h.btcDate]),
      [
        [email("h-ann"), "2026-03-02"],
        [email("h-zed"), null],
      ],
    );
  });

  test("narrows to the people still in the employee list, or to those not, and counts both", async () => {
    const emails = async (status: HistoryStatus) => (await page("h-", "email", status)).rows.map((h) => h.email);
    assert.deepEqual(await emails("active"), [email("h-ann")]);
    assert.deepEqual(await emails("inactive"), [email("h-zed")]);

    const counts = await historyCounts();
    assert.ok(counts.active >= 1 && counts.inactive >= 1);
    assert.equal(counts.active + counts.inactive, counts.total);
  });

  test("a record holds its whole row, who changed it, and the employee behind it", async () => {
    const [ann, zed] = (await page("h-", "email")).rows;
    const detail = await getHistoryDetail(ann!.id);
    assert.ok(detail);
    assert.equal(detail.btcDate, "2026-03-02");
    assert.equal(detail.btcScore, 3.3);
    assert.equal(detail.updatedByName, "admin");
    assert.equal(detail.employee?.title, "Solutions Engineer");

    assert.equal((await getHistoryDetail(zed!.id))?.employee, null);
    assert.equal(await getHistoryDetail("00000000-0000-4000-8000-000000000000"), null);
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
    for (const btcScore of [0, 5, 4.01]) {
      assert.equal(historyInputSchema.safeParse({ ...blank, email: email("a"), btcScore }).success, false);
    }
    const decimal = historyInputSchema.safeParse({ ...blank, email: email("a"), btcScore: 3.25, intScore: 3.5 });
    assert.ok(decimal.success);
    assert.deepEqual([decimal.data.btcScore, decimal.data.intScore], [3.3, 3.5]);
  });
});

describe("HiBob sync", () => {
  const person = (id: string, name: string, manager: string, title = "", dates: Record<string, string | null> = {}) => ({
    id,
    email: email(name),
    fullName: name,
    work: {
      reportsTo: { email: manager && email(manager), displayName: manager },
      startDate: "2025-06-02",
      activeEffectiveDate: "2026-02-02",
      ...dates,
    },
    humanReadable: { work: { title } },
  });

  /** Runs `fn` with these settings saved, then puts back whatever was there. */
  async function withSettings(values: Partial<Record<keyof typeof EVALS_SETTINGS_KEYS, string>>, fn: () => Promise<void>) {
    const keys = Object.keys(values) as (keyof typeof EVALS_SETTINGS_KEYS)[];
    const saved = await db
      .select()
      .from(evalsSettings)
      .where(inArray(evalsSettings.key, keys.map((k) => EVALS_SETTINGS_KEYS[k])));
    for (const k of keys) {
      const row = { key: EVALS_SETTINGS_KEYS[k], value: values[k]!, updatedBy: admin.id };
      await db.insert(evalsSettings).values(row).onConflictDoUpdate({ target: evalsSettings.key, set: row });
    }
    try {
      await fn();
    } finally {
      for (const k of keys) {
        const was = saved.find((r) => r.key === EVALS_SETTINGS_KEYS[k]);
        if (was) await db.update(evalsSettings).set(was).where(eq(evalsSettings.key, was.key));
        else await db.delete(evalsSettings).where(eq(evalsSettings.key, EVALS_SETTINGS_KEYS[k]));
      }
    }
  }

  /** The Google Sheet's cutoffs, whatever the scratch database has saved. */
  const SHEET_CUTOFFS = { startDateOnOrAfter: "2025-04-01", activeEffectiveDateAfter: "2026-01-01" };

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

  test("the sync gives each org member a track, exempt where their history says, and edits keep it", async () => {
    configure();
    // The sync walks down from the configured leader; put it back after.
    const key = EVALS_SETTINGS_KEYS.orgLeaderEmail;
    const [saved] = await db.select().from(evalsSettings).where(eq(evalsSettings.key, key));
    await db
      .insert(evalsSettings)
      .values({ key, value: email("root"), updatedBy: admin.id })
      .onConflictDoUpdate({ target: evalsSettings.key, set: { value: email("root") } });
    try {
      await addTitles(admin.id, "sales", [T("Track AE")]);
      await addTitles(admin.id, "engineer", [T("Track SE")]);
      await importHistory(
        admin.id,
        new File(
          [`email,BTCDate,INTDate\n${email("t-btc")},2000-01-01,\n${email("t-int")},2026-03-01,2000-01-01\n`],
          "h.csv",
        ),
      );
      stubHibob(200, [
        person("1", "root", ""),
        person("2", "t-ae", "root", T("Track AE")),
        person("3", "t-btc", "root", T("Track AE")),
        person("4", "t-int", "root", T("Track SE")),
        person("5", "t-out", "elsewhere", T("Track AE")),
      ]);
      assert.ok((await sync()).ok);
      const tracks = async () =>
        Object.fromEntries(
          (await db.select({ email: employees.email, track: employees.track }).from(employees)).map((e) => [
            e.email.split("@")[0],
            e.track,
          ]),
        );
      assert.deepEqual(await tracks(), {
        root: null,
        "t-ae": "sales",
        "t-btc": "exempt",
        "t-int": "exempt",
        "t-out": null,
      });

      // An edit to someone's history moves their track at once, either way.
      const history = await listHistory();
      const btc = history.find((h) => h.email === email("t-btc"))!;
      assert.deepEqual(await updateHistory(admin.id, btc.id, { btcDate: "2026-04-01" }), { ok: true });
      const exempt = { email: email("t-ae"), btcDate: EXEMPT_DATE, intDate: null, btcScore: null, intScore: null };
      assert.ok((await createHistory(admin.id, historyInputSchema.parse(exempt))).ok);
      const int = history.find((h) => h.email === email("t-int"))!;
      assert.equal(await deleteHistory(int.id), true);
      assert.deepEqual(await tracks(), {
        root: null,
        "t-ae": "exempt",
        "t-btc": "sales",
        "t-int": "engineer",
        "t-out": null,
      });
    } finally {
      if (saved) await db.update(evalsSettings).set(saved).where(eq(evalsSettings.key, key));
      else await db.delete(evalsSettings).where(eq(evalsSettings.key, key));
    }
  });

  test("the sync stores each org member's management chain, from their manager up to the leader", async () => {
    configure();
    await withSettings({ orgLeaderEmail: email("root") }, async () => {
      stubHibob(200, [
        person("1", "ceo", ""),
        person("2", "root", "ceo"),
        person("3", "m-vp", "root"),
        person("4", "m-mgr", "m-vp"),
        person("5", "m-ic", "m-mgr"),
        person("6", "m-out", "ceo"),
      ]);
      assert.ok((await sync()).ok);
      const chains = Object.fromEntries(
        (await db.select({ email: employees.email, chain: employees.managementChain }).from(employees)).map((e) => [
          e.email.split("@")[0],
          e.chain,
        ]),
      );
      assert.deepEqual(chains, {
        ceo: null,
        root: null,
        "m-vp": email("root"),
        "m-mgr": [email("m-vp"), email("root")].join(";"),
        "m-ic": [email("m-mgr"), email("m-vp"), email("root")].join(";"),
        "m-out": null,
      });

      const { rows } = await listOrganizationMembers({ ...ORGANIZATION_LIST, q: email("m-ic"), page: 1 });
      assert.deepEqual(
        rows.map((m) => m.managementChain),
        [[email("m-mgr"), email("m-vp"), email("root")].join(";")],
      );
    });
  });

  test("the Current tab lists candidates by stage, and sorting an undecided title retracks everyone with it", async () => {
    configure();
    await withSettings({ orgLeaderEmail: email("root"), ...SHEET_CUTOFFS }, async () => {
      await addTitles(admin.id, "sales", [T("Cand AE")]);
      await importHistory(
        admin.id,
        new File(
          [`email,BTCDate,INTDate\n${email("c-int")},2026-03-01,\n${email("c-done")},2026-03-01,2026-04-01\n`],
          "h.csv",
        ),
      );
      stubHibob(200, [
        person("1", "root", ""),
        person("2", "c-ae", "root", T("Cand AE")),
        person("3", "c-int", "root", T("Cand AE")),
        person("4", "c-done", "root", T("Cand AE")),
        person("5", "c-new1", "root", T("Cand  Mystery")),
        person("6", "c-new2", "root", T("cand mystery")),
        person("7", "c-odd", "root", T("Cand Odd")),
        person("8", "c-late", "root", T("Cand Late")),
        person("9", "c-out", "elsewhere", T("Cand Odd")),
        person("10", "c-blank", "root", ""),
      ]);
      assert.ok((await sync()).ok);

      const stage = async (s: CandidateStage) =>
        (
          await listCurrentCohort({ stage: s, track: null }, { ...CURRENT_COHORT_LIST, q: "", page: 1, sort: "email", dir: "asc" })
        ).rows.map((m) => [m.email.split("@")[0], m.track, m.btcDate]);
      assert.deepEqual(await stage("bootcamp"), [
        ["c-ae", "sales", null],
        ["c-blank", "undecided", null],
        ["c-late", "undecided", null],
        ["c-new1", "undecided", null],
        ["c-new2", "undecided", null],
        ["c-odd", "undecided", null],
      ]);
      assert.deepEqual(await stage("intermediate"), [["c-int", "sales", "2026-03-01"]]);
      assert.deepEqual((await currentCohortSummary()).counts, {
        bootcamp: { sales: 1, engineer: 0, undecided: 5, deferred: 0 },
        intermediate: { sales: 1, engineer: 0, undecided: 0, deferred: 0 },
      });

      // Engineer: the title goes on the list, and both spellings of it move at once.
      const sorted = await sortUndecidedTitle(admin.id, email("c-new1"), "engineer");
      assert.deepEqual(sorted, {
        ok: true,
        result: { title: T("Cand Mystery"), list: "engineer", added: true, retracked: 2 },
    });
    assert.equal((await myTitles("engineer")).find((t) => t.title === T("Cand Mystery"))?.addedBy, "admin");
    assert.deepEqual(await sortUndecidedTitle(admin.id, email("c-new2"), "sales"), {
      ok: false,
      error: "not_undecided",
    });

    // A title someone listed since the sync stays on its list.
    await addTitles(admin.id, "sales", [T("Cand Late")]);
    const late = await sortUndecidedTitle(admin.id, email("c-late"), "engineer");
    assert.ok(late.ok);
    assert.deepEqual([late.result.list, late.result.added], ["sales", false]);

    // Ignored takes them off the Current tab. No one outside the org can be sorted.
    assert.ok((await sortUndecidedTitle(admin.id, email("c-odd"), "ignored")).ok);
    assert.deepEqual(await sortUndecidedTitle(admin.id, email("c-out"), "ignored"), {
      ok: false,
      error: "not_found",
    });
    assert.deepEqual(await sortUndecidedTitle(admin.id, email("c-blank"), "sales"), { ok: false, error: "no_title" });

    assert.deepEqual(await stage("bootcamp"), [
      ["c-ae", "sales", null],
      ["c-blank", "undecided", null],
      ["c-late", "sales", null],
      ["c-new1", "engineer", null],
      ["c-new2", "engineer", null],
    ]);
    assert.deepEqual((await currentCohortSummary()).counts, {
      bootcamp: { sales: 2, engineer: 2, undecided: 1, deferred: 0 },
      intermediate: { sales: 1, engineer: 0, undecided: 0, deferred: 0 },
    });
    });
  });

  test("the candidate cutoffs leave out the long-hired and the long-placed, until turned off", async () => {
    configure();
    await withSettings({ orgLeaderEmail: email("root"), ...SHEET_CUTOFFS }, async () => {
      await addTitles(admin.id, "sales", [T("Cut AE")]);
      await importHistory(admin.id, new File([`email,BTCDate\n${email("k-int-old")},2026-03-01\n`], "h.csv"));
      const ae = T("Cut AE");
      stubHibob(200, [
        person("1", "root", ""),
        person("2", "k-new", "root", ae),
        person("3", "k-cutoff-day", "root", ae, { startDate: "2025-04-01" }),
        person("4", "k-hired-old", "root", ae, { startDate: "2025-03-31" }),
        person("5", "k-no-start", "root", ae, { startDate: null }),
        person("6", "k-placed-old", "root", ae, { activeEffectiveDate: "2026-01-01" }),
        person("7", "k-no-effective", "root", ae, { activeEffectiveDate: null }),
        person("8", "k-int-old", "root", ae, { startDate: "2024-01-08" }),
      ]);
      assert.ok((await sync()).ok);

      const listed = async () => {
        const rows = [];
        for (const s of ["bootcamp", "intermediate"] as const) {
          const page = await listCurrentCohort(
            { stage: s, track: null },
            { ...CURRENT_COHORT_LIST, q: "", page: 1, sort: "email", dir: "asc" },
          );
          rows.push(...page.rows.map((m) => `${s}:${m.email.split("@")[0]}`));
        }
        return rows;
      };
      // A blank start date passes, as it did in the Sheet; a blank active effective date does not.
      assert.deepEqual(await listed(), ["bootcamp:k-cutoff-day", "bootcamp:k-new", "bootcamp:k-no-start"]);
      assert.deepEqual((await currentCohortSummary()).cutoffs, SHEET_CUTOFFS);
      assert.deepEqual((await currentCohortSummary()).counts.bootcamp, { sales: 3, engineer: 0, undecided: 0, deferred: 0 });

      // Saved empty, each is off; the next read sees it, with no sync between.
      await setCandidateCutoffs(admin.id, { startDateOnOrAfter: null });
      assert.deepEqual(await getCandidateCutoffs(), { startDateOnOrAfter: null, activeEffectiveDateAfter: "2026-01-01" });
      assert.deepEqual(await listed(), [
        "bootcamp:k-cutoff-day",
        "bootcamp:k-hired-old",
        "bootcamp:k-new",
        "bootcamp:k-no-start",
        "intermediate:k-int-old",
      ]);
      await setCandidateCutoffs(admin.id, { activeEffectiveDateAfter: null });
      assert.equal((await currentCohortSummary()).counts.bootcamp.sales, 6);

      // A later day moves the line.
      await setCandidateCutoffs(admin.id, { startDateOnOrAfter: "2025-06-02", activeEffectiveDateAfter: "2026-02-01" });
      assert.deepEqual(await listed(), ["bootcamp:k-new", "bootcamp:k-no-start"]);
    });
  });

  test("ignored titles come first, then anyone who started too close to the next bootcamp is deferred", async (t) => {
    if (await activeBootcamp()) return t.skip("another bootcamp is already active in this database");
    configure();
    await withSettings({ orgLeaderEmail: email("root"), ...SHEET_CUTOFFS, deferralDays: "14" }, async () => {
      await addTitles(admin.id, "sales", [T("Def AE")]);
      await addTitles(admin.id, "ignored", [T("Def Ignored")]);
      await importHistory(admin.id, new File([`email,BTCDate\n${email("d-exempt")},2000-01-01\n`], "h.csv"));
      const made = await createBootcamp(admin.id, { startDate: "2026-11-02", btcDays: 5, intDays: null, status: "active" });
      assert.ok(made.ok);
      try {
        const ae = T("Def AE");
        stubHibob(200, [
          person("1", "root", ""),
          person("2", "d-early", "root", ae, { startDate: "2026-10-01" }),
          person("3", "d-edge", "root", ae, { startDate: "2026-10-19" }),
          person("4", "d-close", "root", ae, { startDate: "2026-10-20" }),
          person("5", "d-after", "root", ae, { startDate: "2026-11-05" }),
          person("6", "d-ignored", "root", T("Def Ignored"), { startDate: "2026-10-25" }),
          person("7", "d-mystery", "root", T("Def Mystery"), { startDate: "2026-10-25" }),
          person("8", "d-no-start", "root", ae, { startDate: null }),
          person("9", "d-exempt", "root", ae, { startDate: "2026-10-25" }),
          person("10", "d-out", "elsewhere", ae, { startDate: "2026-10-25" }),
        ]);
        assert.ok((await sync()).ok);
        const tracks = async () =>
          Object.fromEntries(
            (await db.select({ email: employees.email, track: employees.track }).from(employees))
              .filter((e) => e.email !== email("root"))
              .map((e) => [e.email.split("@")[0], e.track]),
          );
        // Fourteen days before is in time; thirteen, or after it starts, is not.
        assert.deepEqual(await tracks(), {
          "d-early": "sales",
          "d-edge": "sales",
          "d-close": "deferred",
          "d-after": "deferred",
          "d-ignored": "ignored",
          "d-mystery": "deferred",
          "d-no-start": "sales",
          "d-exempt": "exempt",
          "d-out": null,
        });

        const listed = async (filter: Parameters<typeof listCurrentCohort>[0]) =>
          (
            await listCurrentCohort(filter, { ...CURRENT_COHORT_LIST, q: "", page: 1, sort: "email", dir: "asc" })
          ).rows.map((m) => m.email.split("@")[0]);
        assert.deepEqual(await listed({ stage: null, track: "deferred" }), ["d-after", "d-close", "d-mystery"]);
        assert.deepEqual(await listed({ stage: "bootcamp", track: "sales" }), ["d-early", "d-edge", "d-no-start"]);
        assert.deepEqual(await listed({ stage: "intermediate", track: "sales" }), []);
        const summary = await currentCohortSummary();
        assert.deepEqual(summary.counts.bootcamp, { sales: 3, engineer: 0, undecided: 0, deferred: 3 });
        assert.deepEqual(summary.deferral, { days: 14, bootcampStart: "2026-11-02" });

        // Moving the bootcamp later puts the 10-20 and 10-25 starters in time for it.
        assert.deepEqual(await updateBootcamp(made.ok ? made.id : "", { startDate: "2026-11-10" }), { ok: true });
        assert.deepEqual(await listed({ stage: null, track: "deferred" }), ["d-after"]);
        assert.deepEqual(await listed({ stage: null, track: "undecided" }), ["d-mystery"]);

        // A window of 0 turns deferral off, and the undecided title is undecided again.
        await setDeferralDays(admin.id, 0);
        assert.equal(await getDeferralDays(), 0);
        await retrackOrg();
        assert.deepEqual(await listed({ stage: null, track: "deferred" }), []);
        assert.deepEqual(await listed({ stage: null, track: "sales" }), ["d-after", "d-close", "d-early", "d-edge", "d-no-start"]);
      } finally {
        if (made.ok) await deleteBootcamp(made.id);
      }
    });
  });

  test("an administrator can set anyone's track by hand, and it outlasts the sync until handed back", async () => {
    configure();
    await withSettings({ orgLeaderEmail: email("root"), ...SHEET_CUTOFFS }, async () => {
      await addTitles(admin.id, "sales", [T("Hand AE")]);
      await addTitles(admin.id, "ignored", [T("Hand Ignored")]);
      const people = [
        person("1", "root", ""),
        person("2", "h-ae", "root", T("Hand AE")),
        person("3", "h-ignored", "root", T("Hand Ignored")),
        person("4", "h-mystery", "root", T("Hand Mystery")),
        person("5", "h-out", "elsewhere", T("Hand AE")),
      ];
      stubHibob(200, people);
      assert.ok((await sync()).ok);

      assert.deepEqual(await setTrack(admin.id, email("h-ae"), "deferred"), {
        ok: true,
        result: { email: email("h-ae"), track: "deferred", overridden: true },
      });
      assert.ok((await setTrack(admin.id, email("h-ignored"), "engineer")).ok);
      assert.ok((await setTrack(admin.id, email("H-Mystery"), "undecided")).ok);
      assert.deepEqual(await setTrack(admin.id, email("h-out"), "sales"), { ok: false, error: "not_found" });

      // Putting the undecided title on a list leaves the one set by hand alone.
      await addTitles(admin.id, "engineer", [T("Hand Mystery")]);
      stubHibob(200, people);
      assert.ok((await sync()).ok);
      const listed = async () =>
        (
          await listCurrentCohort({ stage: null, track: null }, { ...CURRENT_COHORT_LIST, q: "", page: 1, sort: "email", dir: "asc" })
        ).rows.map((m) => [m.email.split("@")[0], m.track, m.overridden]);
      assert.deepEqual(await listed(), [
        ["h-ae", "deferred", true],
        ["h-ignored", "engineer", true],
        ["h-mystery", "undecided", true],
      ]);

      // Handed back, the rules decide again; ignored and exempt leave the tab.
      assert.deepEqual(await setTrack(admin.id, email("h-ae"), "automatic"), {
        ok: true,
        result: { email: email("h-ae"), track: "sales", overridden: false },
      });
      assert.ok((await setTrack(admin.id, email("h-mystery"), "automatic")).ok);
      assert.ok((await setTrack(admin.id, email("h-ignored"), "exempt")).ok);
      assert.deepEqual(await listed(), [
        ["h-ae", "sales", false],
        ["h-mystery", "engineer", false],
      ]);
    });
  });

  test("a never-saved deferral window is the Sheet's 14 days", async () => {
    await withSettings({ deferralDays: "" }, async () => {
      await db.delete(evalsSettings).where(eq(evalsSettings.key, EVALS_SETTINGS_KEYS.deferralDays));
      assert.equal(await getDeferralDays(), DEFAULT_DEFERRAL_DAYS);
    });
  });

  test("a never-saved cutoff takes the Sheet's day", async () => {
    await withSettings({ startDateOnOrAfter: "" }, async () => {
      await db.delete(evalsSettings).where(eq(evalsSettings.key, EVALS_SETTINGS_KEYS.startDateOnOrAfter));
      assert.equal((await getCandidateCutoffs()).startDateOnOrAfter, DEFAULT_CANDIDATE_CUTOFFS.startDateOnOrAfter);
    });
  });
});

describe("bootcamps", () => {
  const made: string[] = [];
  after(async () => {
    if (made.length > 0) await db.delete(bootcamps).where(inArray(bootcamps.id, made));
  });

  async function create(input: Parameters<typeof createBootcamp>[1]) {
    const result = await createBootcamp(admin.id, input);
    if (result.ok) made.push(result.id);
    return result;
  }

  test("only one is active at a time, and the refusal names it", async (t) => {
    if (await activeBootcamp()) return t.skip("another bootcamp is already active in this database");

    const first = await create({ startDate: "2031-03-03", btcDays: 4, intDays: 3, status: "scheduled" });
    const second = await create({ startDate: "2031-06-02", btcDays: 5, intDays: null, status: "active" });
    assert.ok(first.ok && second.ok);
    const active = { id: second.id, startDate: "2031-06-02", btcDays: 5, intDays: null };
    assert.deepEqual(await activeBootcamp(), active);

    assert.deepEqual(await create({ startDate: "2031-09-01", btcDays: 4, intDays: 3, status: "active" }), {
      ok: false,
      error: "active_exists",
      active,
    });
    assert.deepEqual(await updateBootcamp(first.id, { status: "active" }), {
      ok: false,
      error: "active_exists",
      active,
    });

    assert.deepEqual(await updateBootcamp(second.id, { status: "scheduled" }), { ok: true });
    assert.deepEqual(await updateBootcamp(first.id, { status: "active", intDays: null }), { ok: true });
    assert.deepEqual(await activeBootcamp(), { id: first.id, startDate: "2031-03-03", btcDays: 4, intDays: null });

    const listed = (await listBootcamps({ ...BOOTCAMP_LIST, q: "", page: 1 })).rows.filter((b) => made.includes(b.id));
    assert.deepEqual(
      listed.map((b) => [b.startDate, b.status, b.createdBy]),
      [
        ["2031-06-02", "scheduled", "admin"],
        ["2031-03-03", "active", "admin"],
      ],
    );
  });

  test("a missing bootcamp is not found, and a removed one is gone", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    assert.deepEqual(await updateBootcamp(missing, { btcDays: 2 }), { ok: false, error: "not_found" });
    const made1 = await create({ startDate: "2031-12-01", btcDays: 4, intDays: 3, status: "scheduled" });
    assert.ok(made1.ok);
    assert.equal(await deleteBootcamp(made1.id), true);
    assert.equal(await deleteBootcamp(made1.id), false);
  });

  test("the form's values are checked", () => {
    const ok = { startDate: "2031-03-03", btcDays: 4, intDays: 3, status: "scheduled" };
    assert.ok(bootcampInputSchema.safeParse(ok).success);
    for (const bad of [
      { startDate: "2031-02-30" },
      { btcDays: 0 },
      { btcDays: 31 },
      { btcDays: 2.5 },
      { intDays: 0 },
      { status: "completed" },
    ]) {
      assert.equal(bootcampInputSchema.safeParse({ ...ok, ...bad }).success, false, JSON.stringify(bad));
    }
  });
});
