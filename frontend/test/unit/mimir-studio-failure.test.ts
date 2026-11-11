/**
 * What Mimir Feedback and the Map tab say a failed studio job died of. The
 * errors are as the studio stored them on real jobs (2026-11-02, production),
 * except where marked as the shape a provider documents.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { failureReason } from "@/lib/mimir/studio/failure";

const CREDIT = `400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CgdHUN8M18qbdsjTwinqk"}`;

describe("failureReason", () => {
  test("nothing stored, nothing said", () => {
    assert.equal(failureReason(null), null);
    assert.equal(failureReason("  "), null);
  });

  test("Anthropic out of credit, on the English video", () => {
    assert.equal(failureReason(CREDIT), "The Anthropic API account is out of credit.");
  });

  test("Anthropic out of credit, as the SDK's bare APIError words it", () => {
    const error = `{"type":"error","error":{"details":null,"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CgdGjqiaD9DbxoiNbah7b"}`;
    assert.equal(failureReason(error), "The Anthropic API account is out of credit.");
  });

  test("a translation names its language and that English stays up", () => {
    assert.equal(
      failureReason(`The Español version could not be made, so it plays in English: ${CREDIT}`),
      "Español failed, so it plays in English. The Anthropic API account is out of credit.",
    );
  });

  test("turns used up", () => {
    assert.equal(
      failureReason("The Español version could not be made, so it plays in English: Stopped after 150 turns without finishing."),
      "Español failed, so it plays in English. Stopped after 150 turns without finishing.",
    );
  });

  test("ElevenLabs out of credits (the shape ElevenLabs documents)", () => {
    const error = `The Español version could not be made, so it plays in English: ElevenLabs refused the narration: ElevenLabs /text-to-speech/6wMKsI8ig8FZUfpyZDIY/with-timestamps -> HTTP 401: {"detail":{"status":"quota_exceeded","message":"This request exceeds your quota of 100000. You have 12 credits remaining, while 532 credits are required for this request."}}`;
    assert.equal(failureReason(error), "Español failed, so it plays in English. The ElevenLabs account is out of credits.");
  });

  test("an unrecognised provider error gives its own message", () => {
    assert.equal(
      failureReason(`500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}`),
      "Internal server error",
    );
  });

  test("anything else is given as it was stored, without the error class", () => {
    assert.equal(failureReason("Error: The job stopped reporting and was given up on."), "The job stopped reporting and was given up on.");
  });
});
