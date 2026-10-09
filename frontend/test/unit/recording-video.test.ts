/**
 * The parts of an async video recording that decide what a participant's
 * browser records and what the server asks it for again: which container
 * each stream is recorded in, which chunks are missing, how long to wait
 * before retrying an upload, and what the files download as.
 *
 * `missingChunks` and `retryDelayMs` are what a poor connection leans on; the
 * server's answer to "finish" is only as good as the first, and a room of
 * participants coming back online at once only spreads out because of the
 * second.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  VIDEO_MIME_TYPES,
  RECORDING_RETENTION_DAYS,
  cameraProblem,
  deletesOn,
  missingChunks,
  pickVideoMimeType,
  pieceRanges,
  retryDelayMs,
  screenProblem,
  trackFileName,
  videoContentType,
  videoExtensionFor,
} from "@/lib/recording/video";

describe("pickVideoMimeType", () => {
  test("Chrome and Edge, which record H.264 in MP4, get MP4", () => {
    assert.equal(pickVideoMimeType(() => true, true), "video/mp4;codecs=avc1.640033,mp4a.40.2");
    assert.equal(pickVideoMimeType(() => true, false), "video/mp4;codecs=avc1.640033");
  });

  test("a browser that rejects the high level falls back to one it takes", () => {
    const supported = new Set(["video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus"]);
    assert.equal(pickVideoMimeType((t) => supported.has(t), true), "video/mp4;codecs=avc1,mp4a.40.2");
  });

  test("Firefox, which records only WebM, gets VP9 or VP8", () => {
    const firefox = (t: string) => t.startsWith("video/webm") && !t.includes("h264");
    assert.equal(pickVideoMimeType(firefox, true), "video/webm;codecs=vp9,opus");
    assert.equal(pickVideoMimeType(firefox, false), "video/webm;codecs=vp9");
  });

  test("a stream with no sound is never offered an audio codec", () => {
    for (const t of VIDEO_MIME_TYPES.videoOnly) assert.doesNotMatch(t, /mp4a|opus/);
  });

  test("a browser that records no video gets null", () => {
    assert.equal(pickVideoMimeType(() => false, true), null);
  });
});

describe("videoExtensionFor and videoContentType", () => {
  test("drop the codecs", () => {
    assert.equal(videoExtensionFor("video/mp4;codecs=avc1,mp4a.40.2"), "mp4");
    assert.equal(videoContentType("video/mp4;codecs=avc1,mp4a.40.2"), "video/mp4");
    assert.equal(videoExtensionFor("video/webm;codecs=vp9,opus"), "webm");
    assert.equal(videoContentType("video/webm"), "video/webm");
  });
});

describe("missingChunks", () => {
  test("is empty when every chunk is in, in any order", () => {
    assert.deepEqual(missingChunks([2, 0, 1], 3), []);
  });

  test("names each gap, in order", () => {
    assert.deepEqual(missingChunks([0, 3, 1], 6), [2, 4, 5]);
  });

  test("ignores chunks past the end and counts a duplicate once", () => {
    assert.deepEqual(missingChunks([0, 0, 7], 2), [1]);
  });
});

describe("pieceRanges", () => {
  // Chrome's MP4 recorder can hand over 17 MB at once at 20 Mbit/s; Next.js keeps only the first 10 MB of a body.
  test("cuts a large chunk into pieces of at most the limit, covering every byte once", () => {
    assert.deepEqual(pieceRanges(10, 4), [[0, 4], [4, 8], [8, 10]]);
  });

  test("leaves a chunk under the limit whole", () => {
    assert.deepEqual(pieceRanges(3, 4), [[0, 3]]);
  });

  test("gives an exact multiple no empty piece at the end", () => {
    assert.deepEqual(pieceRanges(8, 4), [[0, 4], [4, 8]]);
  });

  test("gives nothing for nothing", () => {
    assert.deepEqual(pieceRanges(0, 4), []);
  });
});

describe("retryDelayMs", () => {
  const middle = () => 0.5;

  test("doubles from one second", () => {
    assert.deepEqual([0, 1, 2, 3].map((n) => retryDelayMs(n, middle)), [1_000, 2_000, 4_000, 8_000]);
  });

  test("never waits more than half a minute, give or take the jitter", () => {
    assert.equal(retryDelayMs(20, middle), 30_000);
    assert.ok(retryDelayMs(20, () => 0.999) <= 37_500);
  });

  test("spreads retries a quarter either way", () => {
    assert.equal(retryDelayMs(0, () => 0), 750);
    assert.equal(retryDelayMs(0, () => 1), 1_250);
  });
});

describe("trackFileName", () => {
  const at = new Date("2026-10-09T15:43:36.639Z");

  test("names who recorded it, when, and the stream", () => {
    assert.equal(
      trackFileName({ contributor: "Dana Smith", startedAt: at, kind: "screen", mimeType: "video/mp4" }),
      "Dana Smith - 2026-10-09 15-43 UTC - screen.mp4",
    );
  });

  test("strips what a filesystem refuses, and names a take with no name a recording", () => {
    assert.equal(
      trackFileName({ contributor: 'Dana "DJ" Smith / Ops', startedAt: at, kind: "camera", mimeType: "video/webm" }),
      "Dana DJ Smith Ops - 2026-10-09 15-43 UTC - camera.webm",
    );
    assert.equal(
      trackFileName({ contributor: "", startedAt: at, kind: "camera", mimeType: "video/mp4" }),
      "Recording - 2026-10-09 15-43 UTC - camera.mp4",
    );
  });
});

describe("cameraProblem and screenProblem", () => {
  test("a macOS-level block reads differently from a site-level one", () => {
    assert.equal(cameraProblem({ name: "NotAllowedError", message: "Permission denied" }), "blocked");
    assert.equal(cameraProblem({ name: "NotAllowedError", message: "Permission denied by system" }), "blocked_by_system");
  });

  test("a camera another app holds is in use", () => {
    assert.equal(cameraProblem({ name: "NotReadableError", message: "Could not start video source" }), "in_use");
  });

  test("closing the screen picker is a cancel, not an error", () => {
    assert.equal(screenProblem({ name: "NotAllowedError", message: "Permission denied" }), "cancelled");
    assert.equal(screenProblem({ name: "NotAllowedError", message: "Permission denied by system" }), "blocked_by_system");
  });
});

describe("deletesOn", () => {
  test("is the retention window after the recording was made", () => {
    assert.equal(RECORDING_RETENTION_DAYS, 90, "the bucket's lifecycle rule in infra/admin/recordings.tf must change with it");
    assert.equal(deletesOn("2026-10-09T15:43:00.000Z").toISOString(), "2027-01-07T15:43:00.000Z");
  });
});

