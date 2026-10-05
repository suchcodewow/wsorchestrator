/**
 * The parts of recording that decide what a judge is told and what they get:
 * which format a browser records in, what a refused microphone means, and how
 * a recording's length and size read.
 *
 * The `microphoneProblem` cases are the errors browsers actually raise; a
 * macOS-level block in particular has to read differently from a site-level
 * one, because the fix is in System Settings, not the address bar.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  RECORDING_MIME_TYPES,
  extensionFor,
  formatBytes,
  formatDuration,
  microphoneProblem,
  pickMimeType,
} from "@/lib/recording/format";

describe("pickMimeType", () => {
  test("Chrome, Edge and Firefox get Opus in WebM", () => {
    assert.equal(pickMimeType(() => true), "audio/webm;codecs=opus");
  });

  test("Safari, which records only MP4, gets MP4", () => {
    assert.equal(pickMimeType((t) => t === "audio/mp4"), "audio/mp4");
  });

  test("a browser that records none of them gets null", () => {
    assert.equal(pickMimeType(() => false), null);
  });

  test("every candidate has a download extension", () => {
    for (const t of RECORDING_MIME_TYPES) assert.match(extensionFor(t), /^(webm|ogg|m4a)$/, t);
  });
});

describe("extensionFor", () => {
  test("reads the container, not the codec", () => {
    assert.equal(extensionFor("audio/webm;codecs=opus"), "webm");
    assert.equal(extensionFor("audio/ogg; codecs=opus"), "ogg");
    assert.equal(extensionFor("audio/mp4"), "m4a");
  });
});

describe("formatDuration", () => {
  test("minutes and seconds, hours only when there are any", () => {
    assert.equal(formatDuration(0), "0:00");
    assert.equal(formatDuration(7_400), "0:07");
    assert.equal(formatDuration(750_000), "12:30");
    assert.equal(formatDuration(3_723_000), "1:02:03");
  });

  test("never negative", () => {
    assert.equal(formatDuration(-5_000), "0:00");
  });
});

describe("formatBytes", () => {
  test("KB under a megabyte, never 0 KB", () => {
    assert.equal(formatBytes(10), "1 KB");
    assert.equal(formatBytes(870_400), "850 KB");
  });

  test("MB and GB to one place", () => {
    assert.equal(formatBytes(14.2 * 1024 * 1024), "14.2 MB");
    assert.equal(formatBytes(3 * 1024 * 1024 * 1024), "3.0 GB");
  });
});

describe("microphoneProblem", () => {
  const err = (name: string, message = "") => Object.assign(new Error(message), { name });

  test("the site, or the browser's settings, refused", () => {
    assert.equal(microphoneProblem(err("NotAllowedError", "Permission denied")), "blocked");
  });

  test("macOS refused the browser itself", () => {
    // Chrome's wording when System Settings → Privacy & Security → Microphone has it off.
    assert.equal(microphoneProblem(err("NotAllowedError", "Permission denied by system")), "blocked_by_system");
  });

  test("no microphone, a busy one, and a saved one that is gone", () => {
    assert.equal(microphoneProblem(err("NotFoundError", "Requested device not found")), "no_microphone");
    assert.equal(microphoneProblem(err("NotReadableError", "Could not start audio source")), "in_use");
    assert.equal(microphoneProblem(err("OverconstrainedError")), "device_gone");
  });

  test("an insecure page, or something unrecognised", () => {
    assert.equal(microphoneProblem(err("SecurityError")), "unsupported");
    assert.equal(microphoneProblem(err("SomethingNew")), "unknown");
    assert.equal(microphoneProblem(null), "unknown");
  });
});
