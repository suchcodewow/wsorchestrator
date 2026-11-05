/** The Slack message a release sends to managers, and who gets it. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { releaseNoticeRecipients, releaseNoticeText } from "@/lib/reporting/release-notice-values";

describe("releaseNoticeText", () => {
  const url = "https://harnessevents.io/reporting/bootcamp";

  test("names the month and the class, and links Click here to the reporting page", () => {
    assert.equal(
      releaseNoticeText("bootcamp", "2026-11-17", url),
      "Feedback has been released for November 2026 Bootcamp!  <https://harnessevents.io/reporting/bootcamp|Click here> to view results for your attendees",
    );
  });

  test("says Intermediate for an INT release", () => {
    assert.match(releaseNoticeText("intermediate", "2026-11-17", url), /^Feedback has been released for November 2026 Intermediate!/);
  });

  test("takes the month from the bootcamp's start, whatever the time zone", () => {
    assert.match(releaseNoticeText("bootcamp", "2027-03-01", url), /for March 2027 Bootcamp!/);
  });
});

describe("releaseNoticeRecipients", () => {
  test("is everyone in every chain, each once, in the order first met", () => {
    assert.deepEqual(
      releaseNoticeRecipients(["m1@x.io;d1@x.io;cro@x.io", "m2@x.io;d1@x.io;cro@x.io", "M1@x.io ; cro@x.io"]),
      ["m1@x.io", "d1@x.io", "cro@x.io", "m2@x.io"],
    );
  });

  test("skips anyone with no chain", () => {
    assert.deepEqual(releaseNoticeRecipients([null, "", "m1@x.io;"]), ["m1@x.io"]);
  });
});
