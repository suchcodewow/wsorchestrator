/**
 * Who a take belongs to, and what the Recordings page says about each one:
 * who recorded it, how long, what it includes, whether it is still
 * uploading, and whether its upload has stalled — the page was closed — so
 * the training team knows to ask for the page to be reopened.
 *
 * Anyone in the org records, signed in but with no role, so the one rule with
 * an edge is ownership: a take is its recorder's, and nobody else may add a
 * stream or a chunk to it.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { recordingTracks } from "@/db/schema";
import { RECORDING_LIST } from "@/lib/list-specs";
import {
  deleteTake,
  findTrack,
  getTake,
  listTakes,
  purgeExpiredTakes,
  registerTrack,
} from "@/lib/recording/recordings";
import { PERSONAS } from "../support/access";
import { testScope } from "../support/seed";

const scope = testScope("rec");
const takes: string[] = [];

before(() => scope.setUp());
after(async () => {
  for (const id of takes) await deleteTake(id);
  await scope.tearDown();
});

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

/** Someone in the org with no role at all: all recording needs. */
const recorder = (key = "recorder") => scope.createUser(key, PERSONAS.nobody).then((u) => u.id);

async function take(userId: string, contributor: string, startedAt: Date, kinds: ("camera" | "screen")[] = ["camera", "screen"]) {
  const takeId = randomUUID();
  takes.push(takeId);
  for (const kind of kinds) {
    const track = await registerTrack(userId, { takeId, kind, mimeType: "video/mp4", startedAt, offsetMs: 0, contributor });
    assert.ok(track, `${kind} was filed`);
  }
  return takeId;
}

const listed = async (contributor: string) =>
  (await listTakes({ ...RECORDING_LIST, q: contributor, page: 1 })).rows.find((r) => r.contributor === contributor)!;

describe("a take's owner", () => {
  test("files it again unchanged after a reload", async () => {
    const me = await recorder();
    const takeId = await take(me, `rec_${randomUUID()}`, new Date(), ["camera"]);
    const again = await registerTrack(me, { takeId, kind: "camera", mimeType: "video/mp4", startedAt: new Date(), offsetMs: 0, contributor: "" });
    assert.equal(again?.takeId, takeId);
  });

  test("is the only one who can add to it or find it", async () => {
    const me = await recorder("owner");
    const someoneElse = await recorder("other");
    const takeId = await take(me, `rec_${randomUUID()}`, new Date(), ["camera"]);

    const theirs = await registerTrack(someoneElse, { takeId, kind: "screen", mimeType: "video/mp4", startedAt: new Date(), offsetMs: 0, contributor: "" });
    assert.equal(theirs, null, "a second account cannot file a stream on the take");
    assert.equal(await findTrack(someoneElse, takeId, "camera"), null, "nor reach its camera to upload to");
    assert.ok(await findTrack(me, takeId, "camera"));
  });
});

describe("a take in the list", () => {
  test("rolls its streams into one row: who, what it includes, length and size", async () => {
    const me = await recorder();
    const name = `rec_${randomUUID()}`;
    const takeId = await take(me, name, minutesAgo(30));
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
    const me = await recorder();
    const name = `rec_${randomUUID()}`;
    await take(me, name, minutesAgo(1), ["camera"]);
    const row = await listed(name);
    assert.deepEqual([row.kinds, row.status], [["camera"], "uploading"]);
  });

  test("is failed if any stream failed", async () => {
    const me = await recorder();
    const name = `rec_${randomUUID()}`;
    const takeId = await take(me, name, minutesAgo(5));
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
    const me = await recorder();
    const name = `rec_${randomUUID()}`;
    const takeId = await take(me, name, minutesAgo(5));
    await db.update(recordingTracks).set({ lastChunkAt: minutesAgo(0.2) }).where(eq(recordingTracks.takeId, takeId));
    assert.equal((await listed(name)).stalled, false);
  });

  test("one with no chunk for a few minutes is, in the list and on each stream", async () => {
    const me = await recorder();
    const name = `rec_${randomUUID()}`;
    const takeId = await take(me, name, minutesAgo(10));
    await db.update(recordingTracks).set({ lastChunkAt: minutesAgo(3) }).where(eq(recordingTracks.takeId, takeId));
    assert.equal((await listed(name)).stalled, true);
    assert.deepEqual((await getTake(takeId))!.tracks.map((t) => t.stalled), [true, true]);
  });

  test("a finished stream is never stalled, however long ago it last uploaded", async () => {
    const me = await recorder();
    const name = `rec_${randomUUID()}`;
    const takeId = await take(me, name, minutesAgo(90));
    await db.update(recordingTracks).set({ status: "ready", lastChunkAt: minutesAgo(80) }).where(eq(recordingTracks.takeId, takeId));
    assert.equal((await listed(name)).stalled, false);
  });
});

describe("deleting a take", () => {
  test("removes every stream of it, and says who recorded it", async () => {
    const me = await recorder();
    const name = `rec_${randomUUID()}`;
    const takeId = await take(me, name, minutesAgo(1));
    assert.equal(await deleteTake(takeId), name);
    assert.equal(await getTake(takeId), null);
    assert.equal(await deleteTake(takeId), null, "a second delete finds nothing");
  });
});

describe("retention", () => {
  test("a recording past 90 days is hidden at once, then purged", async () => {
    const me = await recorder();
    const name = `rec_${randomUUID()}`;
    const takeId = await take(me, name, new Date(Date.now() - 91 * 24 * 60 * 60_000));
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
    const me = await recorder();
    const name = `rec_${randomUUID()}`;
    await take(me, name, new Date(Date.now() - 89 * 24 * 60 * 60_000));
    await purgeExpiredTakes();
    assert.ok(await listed(name));
  });
});

