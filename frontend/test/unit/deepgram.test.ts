/**
 * Deepgram keeps the audio and transcript of any request that does not say
 * `mip_opt_out=true`, and offers no account setting to stop it. So every URL
 * we send audio to must carry the flag, whatever else is added to it.
 *
 * The message shapes are what Deepgram's live socket and pre-recorded endpoint
 * actually returned for a synthesized "Testing one two three" (2026-10-04).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  liveListenUrl,
  parseLiveMessage,
  prerecordedListenUrl,
  prerecordedTranscript,
} from "@/lib/recording/deepgram";

describe("listen URLs", () => {
  for (const [name, url] of [
    ["live", liveListenUrl()],
    ["pre-recorded", prerecordedListenUrl()],
  ] as const) {
    test(`${name} opts out of Deepgram's model training`, () => {
      assert.equal(new URL(url).searchParams.getAll("mip_opt_out").join(), "true");
    });
  }

  test("live is a socket that sends interim results", () => {
    const url = new URL(liveListenUrl());
    assert.equal(url.protocol, "wss:");
    assert.equal(url.searchParams.get("interim_results"), "true");
  });

  test("pre-recorded is plain HTTPS", () => {
    assert.equal(new URL(prerecordedListenUrl()).protocol, "https:");
  });
});

describe("parseLiveMessage", () => {
  const results = (transcript: string, isFinal: boolean) =>
    JSON.stringify({
      type: "Results",
      is_final: isFinal,
      speech_final: isFinal,
      channel: { alternatives: [{ transcript, confidence: 0.99, words: [] }] },
    });

  test("an interim result", () => {
    assert.deepEqual(parseLiveMessage(results("Testing one two", false)), {
      text: "Testing one two",
      isFinal: false,
    });
  });

  test("a final result", () => {
    assert.deepEqual(parseLiveMessage(results("Testing one, two, three.", true)), {
      text: "Testing one, two, three.",
      isFinal: true,
    });
  });

  test("the empty final Deepgram sends as the stream closes", () => {
    assert.deepEqual(parseLiveMessage(results("", true)), { text: "", isFinal: true });
  });

  test("anything that is not a transcript", () => {
    assert.equal(parseLiveMessage(JSON.stringify({ type: "Metadata", request_id: "x" })), null);
    assert.equal(parseLiveMessage(JSON.stringify({ type: "SpeechStarted" })), null);
    assert.equal(parseLiveMessage("not json"), null);
    assert.equal(parseLiveMessage(new ArrayBuffer(4)), null);
  });
});

describe("prerecordedTranscript", () => {
  test("reads the first channel's best alternative", () => {
    const body = {
      metadata: { request_id: "x" },
      results: { channels: [{ alternatives: [{ transcript: "The quick brown fox.", confidence: 0.99 }] }] },
    };
    assert.equal(prerecordedTranscript(body), "The quick brown fox.");
  });

  test("nothing heard, or an unexpected body, is empty", () => {
    assert.equal(prerecordedTranscript({ results: { channels: [] } }), "");
    assert.equal(prerecordedTranscript(null), "");
  });
});
