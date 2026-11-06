/**
 * Who the Diagnostic's Participants are, against a real database.
 *
 * The rules, restated here independently of `lib/iris/participants`:
 * 1. Only a Participant takes the tests; a role alone does not make one.
 * 2. Someone added by hand is a Participant until removed, whether Bootcamp
 *    Auto-Enroll is on or off.
 * 3. While auto-enroll is on, every bootcamp candidate on the Sales or
 *    Engineer track who has RSVP'd is a Participant; one who has not RSVP'd,
 *    or has no track yet, is not.
 * 4. Stopping auto-enroll removes everyone it brought in, and only them.
 *
 * Auto-enroll is one setting for the whole database, so the suite saves it
 * before it starts and puts it back afterwards.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq, like } from "drizzle-orm";

import { db } from "@/db";
import { IRIS_SETTINGS_KEYS, employees, intakeResponses, irisSettings, type EmployeeTrack } from "@/db/schema";
import {
  addParticipant,
  getAutoEnroll,
  isParticipantNow,
  listParticipants,
  removeParticipant,
  setAutoEnroll,
} from "@/lib/iris/participants";
import { IRIS_PARTICIPANT_LIST } from "@/lib/list-specs";
import { PERSONAS } from "../support/access";
import { TEST_EMAIL_DOMAIN, TEST_PREFIX } from "../support/db";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("irisp");
const today = new Date().toISOString().slice(0, 10);
const scoped = `${TEST_PREFIX}irisp_%`;

let savedSetting: (typeof irisSettings.$inferSelect)[] = [];
let admin: TestUser;

before(async () => {
  await scope.setUp();
  savedSetting = await db.select().from(irisSettings).where(eq(irisSettings.key, IRIS_SETTINGS_KEYS.bootcampAutoEnroll));
  admin = await scope.createUser("admin", PERSONAS.assessmentsAdmin);
});

after(async () => {
  await db.delete(intakeResponses).where(like(intakeResponses.email, scoped));
  await db.delete(irisSettings).where(eq(irisSettings.key, IRIS_SETTINGS_KEYS.bootcampAutoEnroll));
  if (savedSetting.length) await db.insert(irisSettings).values(savedSetting);
  await scope.tearDown();
});

/** A current bootcamp candidate on `track`, or none yet, who has RSVP'd when `rsvp` says so. */
async function candidate(key: string, track: EmployeeTrack | null, rsvp: boolean): Promise<string> {
  const email = `${TEST_PREFIX}irisp_${key}@${TEST_EMAIL_DOMAIN}`;
  await db.insert(employees).values({
    id: `${TEST_PREFIX}irisp_${key}`,
    email,
    fullName: `Attendee ${key}`,
    title: "Account Executive",
    track,
    orgDepth: 2,
    startDate: today,
    activeEffectiveDate: today,
    raw: {},
  });
  if (rsvp) await db.insert(intakeResponses).values({ form: "bootcamp", email, answers: {} });
  return email;
}

/** Everyone the suite made who is listed, as email → whether they were added by hand. */
async function listed(): Promise<Map<string, boolean>> {
  const page = await listParticipants({ ...IRIS_PARTICIPANT_LIST, q: "irisp_", page: 1 }, "A");
  return new Map(page.rows.map((r) => [r.email, r.manual]));
}

describe("Participants added by hand", () => {
  test("a role alone does not make a Participant", async () => {
    assert.equal(await isParticipantNow(admin.email), false);
  });

  test("an employee or an account here can be added, once, and removed", async () => {
    const email = await candidate("byhand", null, false);
    assert.equal(await isParticipantNow(email), false);
    const added = await addParticipant(admin.id, email.toUpperCase());
    assert.deepEqual(added, { ok: true, email, fullName: "Attendee byhand" });
    assert.equal(await isParticipantNow(email), true);
    assert.equal((await listed()).get(email), true);
    assert.deepEqual(await addParticipant(admin.id, email), { ok: false, error: "duplicate" });

    // An account with no employee row, such as a test account, can be added too.
    assert.deepEqual(await addParticipant(admin.id, admin.email), { ok: true, email: admin.email, fullName: "admin" });
    assert.equal(await isParticipantNow(admin.email), true);
    assert.deepEqual(await removeParticipant(admin.email), { ok: true });

    assert.deepEqual(await removeParticipant(email), { ok: true });
    assert.equal(await isParticipantNow(email), false);
    assert.deepEqual(await removeParticipant(email), { ok: false, error: "not_found" });
  });

  test("nobody known can be added", async () => {
    assert.deepEqual(await addParticipant(admin.id, `nobody-${TEST_PREFIX}@${TEST_EMAIL_DOMAIN}`), {
      ok: false,
      error: "unknown_person",
    });
  });
});

describe("Bootcamp Auto-Enroll", () => {
  let rsvped: string;
  let engineer: string;
  let silent: string;
  let undecided: string;

  before(async () => {
    await setAutoEnroll(admin.id, false);
    rsvped = await candidate("rsvped", "sales", true);
    engineer = await candidate("engineer", "engineer", true);
    silent = await candidate("silent", "sales", false);
    undecided = await candidate("undecided", null, true);
  });

  test("off, it enrolls nobody", async () => {
    assert.equal((await getAutoEnroll()).on, false);
    for (const email of [rsvped, engineer, silent, undecided]) assert.equal(await isParticipantNow(email), false, email);
    assert.equal((await listed()).size, 0);
  });

  test("on, it enrolls those on a track who have RSVP'd, and nobody else", async () => {
    const state = await setAutoEnroll(admin.id, true);
    assert.equal(state.on, true);
    assert.equal(state.changedBy, "admin");
    assert.equal(await isParticipantNow(rsvped), true);
    assert.equal(await isParticipantNow(engineer), true);
    assert.equal(await isParticipantNow(silent), false, "has not RSVP'd");
    assert.equal(await isParticipantNow(undecided), false, "has no track yet");
    assert.deepEqual(
      [...(await listed())].sort(),
      [
        [engineer, false],
        [rsvped, false],
      ],
    );
  });

  test("someone who RSVPs while it is on is enrolled at once", async () => {
    await db.insert(intakeResponses).values({ form: "bootcamp", email: silent, answers: {} });
    assert.equal(await isParticipantNow(silent), true);
  });

  test("adding an auto-enrolled person by hand marks them so, without listing them twice", async () => {
    assert.ok((await addParticipant(admin.id, rsvped)).ok);
    const rows = await listed();
    assert.equal(rows.get(rsvped), true);
    assert.equal(rows.size, 3);
  });

  test("stopping it removes everyone it brought in, and keeps the hand-added", async () => {
    assert.equal((await setAutoEnroll(admin.id, false)).on, false);
    assert.equal(await isParticipantNow(engineer), false);
    assert.equal(await isParticipantNow(silent), false);
    assert.equal(await isParticipantNow(rsvped), true, "added by hand, which outlasts auto-enroll");
    assert.deepEqual([...(await listed())], [[rsvped, true]]);
  });

  test("removing the hand-added override while it is on leaves them auto-enrolled", async () => {
    await setAutoEnroll(admin.id, true);
    assert.deepEqual(await removeParticipant(rsvped), { ok: true });
    assert.equal(await isParticipantNow(rsvped), true);
    assert.equal((await listed()).get(rsvped), false);
    await setAutoEnroll(admin.id, false);
    assert.equal(await isParticipantNow(rsvped), false);
  });
});
