/**
 * Feedback on videos against a real database: which videos a caller may
 * rate — a Mimir concept's video anyone signed in, a recording only whoever
 * may watch recordings — what each press saves, how it reads back, and that a
 * recording's feedback goes with the take.
 *
 * The map is one row for the whole database, so the suite clears it. Feedback
 * outlives the test accounts (user_id is set null), so each row made here is
 * deleted by its id.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { mimirMap, videoFeedback } from "@/db/schema";
import { VIDEO_FEEDBACK_LIST, VIDEO_FEEDBACK_SUMMARY_LIST } from "@/lib/list-specs";
import { importMap } from "@/lib/mimir/map/content";
import { MAP_ID } from "@/lib/mimir/map/schema";
import { deleteTake, registerTrack } from "@/lib/recording/recordings";
import { findVideo, listVideoFeedback, listVideoFeedbackSummary, recordVideoFeedback } from "@/lib/video-feedback";
import { PERSONAS } from "../support/access";
import { mapFixture } from "../support/mimir-map";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("vidfb");
const feedbackIds: string[] = [];
const takes: string[] = [];
/** In every comment here, so a search finds only this suite's rows. */
const MARK = `vidfb-${randomUUID().slice(0, 8)}`;

let admin: TestUser;
let viewer: TestUser;
let trackId: string;

before(async () => {
  await scope.setUp();
  admin = await scope.createUser("admin", PERSONAS.trainingAdmin);
  viewer = await scope.createUser("viewer", PERSONAS.nobody);
  await importMap(admin.id, mapFixture());
  const takeId = randomUUID();
  takes.push(takeId);
  const track = await registerTrack(admin.id, {
    takeId,
    kind: "camera",
    mimeType: "video/mp4",
    startedAt: new Date(),
    offsetMs: 0,
    contributor: "Feedback Test",
  });
  trackId = track!.id;
});

after(async () => {
  if (feedbackIds.length) await db.delete(videoFeedback).where(inArray(videoFeedback.id, feedbackIds));
  for (const id of takes) await deleteTake(id);
  await db.delete(mimirMap).where(eq(mimirMap.id, MAP_ID));
  await scope.tearDown();
});

describe("which videos can be rated", () => {
  test("a concept's video, by anyone signed in, under the concept's name", async () => {
    const found = await findVideo(viewer.access, { kind: "mimir_concept", id: "alpha" });
    assert.deepEqual(found, { kind: "mimir_concept", conceptId: "alpha", recordingTrackId: null, label: "Alpha" });
  });

  test("not a concept with no video, nor one that does not exist", async () => {
    assert.equal(await findVideo(viewer.access, { kind: "mimir_concept", id: "beta" }), null);
    assert.equal(await findVideo(viewer.access, { kind: "mimir_concept", id: "nope" }), null);
  });

  test("a recording only by whoever may watch recordings", async () => {
    assert.equal(await findVideo(viewer.access, { kind: "recording", id: trackId }), "forbidden");
    const found = await findVideo(admin.access, { kind: "recording", id: trackId });
    assert.deepEqual(found, { kind: "recording", conceptId: null, recordingTrackId: trackId, label: "Feedback Test — camera" });
    assert.equal(await findVideo(admin.access, { kind: "recording", id: "not-a-uuid" }), null);
    assert.equal(await findVideo(admin.access, { kind: "recording", id: randomUUID() }), null);
  });
});

describe("saving and reading back", () => {
  test("every press is its own row, with who, which video, where, and the comment", async () => {
    const alpha = (await findVideo(viewer.access, { kind: "mimir_concept", id: "alpha" }))!;
    assert.notEqual(alpha, "forbidden");
    if (alpha === "forbidden") return;
    const up = await recordVideoFeedback(viewer.id, alpha, { rating: "up", position: 12.5, comment: `${MARK} clear` });
    const down = await recordVideoFeedback(viewer.id, alpha, { rating: "down", position: 40, comment: null });
    feedbackIds.push(up.id, down.id);

    assert.equal(up.rating, "up");
    assert.equal(up.positionSeconds, 12.5);
    assert.deepEqual(up.video, { kind: "mimir_concept", id: "alpha", label: "Alpha" });
    assert.equal(down.comment, null);

    const page = await listVideoFeedback({ ...VIDEO_FEEDBACK_LIST, q: MARK, page: 1 });
    assert.deepEqual(page.rows.map((r) => r.id), [up.id]);
    assert.equal(page.rows[0]!.user?.email, viewer.email);

    const downs = await listVideoFeedback({ ...VIDEO_FEEDBACK_LIST, q: viewer.email, page: 1 }, { rating: "down" });
    assert.deepEqual(downs.rows.map((r) => r.id), [down.id]);
    const recordings = await listVideoFeedback({ ...VIDEO_FEEDBACK_LIST, q: viewer.email, page: 1 }, { kind: "recording" });
    assert.deepEqual(recordings.rows, []);
  });

  test("a recording's feedback is deleted with the take", async () => {
    const takeId = randomUUID();
    const track = await registerTrack(admin.id, {
      takeId,
      kind: "screen",
      mimeType: "video/mp4",
      startedAt: new Date(),
      offsetMs: 0,
      contributor: "Deleted Soon",
    });
    const video = (await findVideo(admin.access, { kind: "recording", id: track!.id }))!;
    if (video === "forbidden") return assert.fail("an administrator may rate a recording");
    const row = await recordVideoFeedback(admin.id, video, { rating: "down", position: 3, comment: `${MARK} gone` });
    feedbackIds.push(row.id);

    await deleteTake(takeId);
    assert.deepEqual(await db.select().from(videoFeedback).where(eq(videoFeedback.id, row.id)), []);
  });
});

describe("the summary of each Mimir video", () => {
  const summaryOf = async () => {
    const page = await listVideoFeedbackSummary({ ...VIDEO_FEEDBACK_SUMMARY_LIST, q: "", page: 1 });
    return page.rows.find((r) => r.conceptId === "alpha");
  };

  test("counts smiley and confused ratings, and those with a comment, and leaves out recordings", async () => {
    const before = (await summaryOf()) ?? { up: 0, upComments: 0, down: 0, downComments: 0 };
    const alpha = (await findVideo(viewer.access, { kind: "mimir_concept", id: "alpha" }))!;
    if (alpha === "forbidden") return assert.fail("anyone may rate a concept");
    const rows = [
      await recordVideoFeedback(viewer.id, alpha, { rating: "up", position: 30, comment: `${MARK} late` }),
      await recordVideoFeedback(viewer.id, alpha, { rating: "up", position: 3, comment: null }),
      await recordVideoFeedback(viewer.id, alpha, { rating: "down", position: 9, comment: `${MARK} early` }),
    ];
    feedbackIds.push(...rows.map((r) => r.id));
    const recording = (await findVideo(admin.access, { kind: "recording", id: trackId }))!;
    if (recording === "forbidden") return assert.fail("an administrator may rate a recording");
    feedbackIds.push((await recordVideoFeedback(admin.id, recording, { rating: "up", position: 1, comment: null })).id);

    const after = (await summaryOf())!;
    assert.equal(after.label, "Alpha");
    assert.equal(after.up - before.up, 2);
    assert.equal(after.upComments - before.upComments, 1);
    assert.equal(after.down - before.down, 1);
    assert.equal(after.downComments - before.downComments, 1);

    const all = await listVideoFeedbackSummary({ ...VIDEO_FEEDBACK_SUMMARY_LIST, q: "", page: 1 });
    assert.ok(all.rows.every((r) => r.conceptId !== trackId));
  });

  test("one video's feedback reads back from the start of the video to its end", async () => {
    const page = await listVideoFeedback(
      { ...VIDEO_FEEDBACK_LIST, sort: "position", dir: "asc", q: viewer.email, page: 1 },
      { kind: "mimir_concept", video: "alpha" },
    );
    const positions = page.rows.map((r) => r.positionSeconds);
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
    assert.ok(page.rows.length >= 3);
    assert.ok(page.rows.every((r) => r.video.id === "alpha"));
  });
});
