/**
 * The recording link and what the Recordings page says about each take:
 * who recorded it, how long, what it includes, whether it is still
 * uploading, and whether its upload has stalled — the page was closed — so
 * whoever shared the link knows to ask for it to be reopened.
 *
 * Replacing the link is the one action with a sharp edge: it must stop new
 * takes on the old link at once without stranding a take already uploading
 * on it, since that take's only copy may be on someone else's computer.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { recordingLinks, recordingTracks } from "@/db/schema";
import { RECORDING_LIST } from "@/lib/list-specs";
import {
  deleteTake,
  getActiveLink,
  getTake,
  isActiveLink,
  listTakes,
  purgeExpiredTakes,
  registerTrack,
  replaceLink,
} from "@/lib/recording/recordings";
import { PERSONAS } from "../support/access";
import { testScope } from "../support/seed";

const scope = testScope("rec");
const takes: string[] = [];
const links: string[] = [];
/** The link in use before these tests replaced it, put back after: the scratch database is a developer's too. */
let wasActive: string | null = null;

before(async () => {
  await scope.setUp();
  wasActive = (await getActiveLink())?.id ?? null;
});
after(async () => {
  for (const id of takes) await deleteTake(id);
  for (const id of links) await db.delete(recordingLinks).where(eq(recordingLinks.id, id));
  if (wasActive) await db.update(recordingLinks).set({ retiredAt: null }).where(eq(recordingLinks.id, wasActive));
  await scope.tearDown();
});

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

async function newLink() {
  const user = await scope.createUser("admin", PERSONAS.trainingAdmin);
  const link = await replaceLink(user.id);
  links.push(link.id);
  return link.id;
}

async function take(linkId: string, contributor: string, startedAt: Date, kinds: ("camera" | "screen")[] = ["camera", "screen"]) {
  const takeId = randomUUID();
  takes.push(takeId);
  for (const kind of kinds) {
    const track = await registerTrack(linkId, { takeId, kind, mimeType: "video/mp4", startedAt, offsetMs: 0, contributor });
    assert.ok(track, `${kind} was filed`);
  }
  return takeId;
}

const listed = async (contributor: string) =>
  (await listTakes({ ...RECORDING_LIST, q: contributor, page: 1 })).rows.find((r) => r.contributor === contributor)!;

describe("the recording link", () => {
  test("replacing it retires the old one, and only the new one takes new recordings", async () => {
    const first = await newLink();
    const second = await newLink();
    assert.equal((await getActiveLink())?.id, second);
    assert.equal(await isActiveLink(first), false);
    assert.equal(await isActiveLink(second), true);
  });

  test("a take already uploading on a replaced link still files its streams; a new one does not", async () => {
    const old = await newLink();
    const name = `rec_${randomUUID()}`;
    const takeId = await take(old, name, minutesAgo(1), ["camera"]);
    await newLink();

    const again = await registerTrack(old, { takeId, kind: "camera", mimeType: "video/mp4", startedAt: minutesAgo(1), offsetMs: 0, contributor: name });
    assert.ok(again, "the browser filing the same stream again after a reload is answered");
    const fresh = await registerTrack(old, { takeId: randomUUID(), kind: "camera", mimeType: "video/mp4", startedAt: new Date(), offsetMs: 0, contributor: "" });
    assert.equal(fresh, null, "a new take on the old link is refused");
  });
});

describe("a take in the list", () => {
  test("rolls its streams into one row: who, what it includes, length and size", async () => {
    const link = await newLink();
    const name = `rec_${randomUUID()}`;
    const takeId = await take(link, name, minutesAgo(30));
    await db
      .update(recordingTracks)
      .set({ status: "ready", fileBytes: 1_000_000, durationMs: 61_000, lastChunkAt: minutesAgo(29) })
      .where(eq(recordingTracks.takeId, takeId));

    const row = await listed(name);
    assert.deepEqual(row.kinds, ["camera", "screen"]);
    assert.equal(row.bytes, 2_000_000);
    assert.equal(row.durationMs, 61_000);
    assert.equal(row.status, "ready");
    assert.equal(row.stalled, false);
  });

  test("is uploading while any stream is, and a camera-only take includes just the camera", async () => {
    const link = await newLink();
    const name = `rec_${randomUUID()}`;
    await take(link, name, minutesAgo(1), ["camera"]);
    const row = await listed(name);
    assert.deepEqual([row.kinds, row.status], [["camera"], "uploading"]);
  });

  test("is failed if any stream failed", async () => {
    const link = await newLink();
    const name = `rec_${randomUUID()}`;
    const takeId = await take(link, name, minutesAgo(5));
    await db.update(recordingTracks).set({ status: "ready" }).where(eq(recordingTracks.takeId, takeId));
    await db
      .update(recordingTracks)
      .set({ status: "failed" })
      .where(and(eq(recordingTracks.takeId, takeId), eq(recordingTracks.kind, "screen")));
    assert.equal((await listed(name)).status, "failed");
  });
});

describe("stalled", () => {
  test("an upload still arriving is not stalled", async () => {
    const link = await newLink();
    const name = `rec_${randomUUID()}`;
    const takeId = await take(link, name, minutesAgo(5));
    await db.update(recordingTracks).set({ lastChunkAt: minutesAgo(0.2) }).where(eq(recordingTracks.takeId, takeId));
    assert.equal((await listed(name)).stalled, false);
  });

  test("one with no chunk for a few minutes is, in the list and on each stream", async () => {
    const link = await newLink();
    const name = `rec_${randomUUID()}`;
    const takeId = await take(link, name, minutesAgo(10));
    await db.update(recordingTracks).set({ lastChunkAt: minutesAgo(3) }).where(eq(recordingTracks.takeId, takeId));
    assert.equal((await listed(name)).stalled, true);
    assert.deepEqual((await getTake(takeId))!.tracks.map((t) => t.stalled), [true, true]);
  });

  test("a finished stream is never stalled, however long ago it last uploaded", async () => {
    const link = await newLink();
    const name = `rec_${randomUUID()}`;
    const takeId = await take(link, name, minutesAgo(90));
    await db.update(recordingTracks).set({ status: "ready", lastChunkAt: minutesAgo(80) }).where(eq(recordingTracks.takeId, takeId));
    assert.equal((await listed(name)).stalled, false);
  });
});

describe("deleting a take", () => {
  test("removes every stream of it, and says who recorded it", async () => {
    const link = await newLink();
    const name = `rec_${randomUUID()}`;
    const takeId = await take(link, name, minutesAgo(1));
    assert.equal(await deleteTake(takeId), name);
    assert.equal(await getTake(takeId), null);
    assert.equal(await deleteTake(takeId), null, "a second delete finds nothing");
  });
});

describe("retention", () => {
  test("a recording past 90 days is hidden at once, then purged", async () => {
    const link = await newLink();
    const name = `rec_${randomUUID()}`;
    const takeId = await take(link, name, new Date(Date.now() - 91 * 24 * 60 * 60_000));
    await db.update(recordingTracks).set({ status: "ready" }).where(eq(recordingTracks.takeId, takeId));

    assert.equal(await listed(name), undefined, "not listed once expired");
    assert.equal(await getTake(takeId), null, "not readable once expired");

    const purged: { takeId: string; contributor: string }[] = [];
    // A purge takes a batch at a time; a database left over from other runs may hold more.
    for (let batch = await purgeExpiredTakes(); batch.length > 0; batch = await purgeExpiredTakes()) purged.push(...batch);
    assert.deepEqual(purged.find((p) => p.takeId === takeId), { takeId, contributor: name }, "says what it removed, for the audit trail");
    const rows = await db.select().from(recordingTracks).where(eq(recordingTracks.takeId, takeId));
    assert.equal(rows.length, 0, "its rows are gone");
  });

  test("one inside the window is kept", async () => {
    const link = await newLink();
    const name = `rec_${randomUUID()}`;
    await take(link, name, new Date(Date.now() - 89 * 24 * 60 * 60_000));
    await purgeExpiredTakes();
    assert.ok(await listed(name));
  });
});

