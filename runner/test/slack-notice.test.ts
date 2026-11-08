/**
 * The Slack notices about a build: what each one says and links to. The sending
 * is best-effort and needs Slack, so what is checked here is the part that can
 * be wrong without anyone noticing: a link to the wrong page, a person who is
 * not tagged, a workshop name that Slack reads as markup.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  appUrl,
  buildPageUrl,
  escapeSlack,
  failedText,
  readyText,
  startedText,
  userPageUrl,
} from "../src/slack-notice.js";

const BASE = "https://app.example.com";
const RUN = "7d0c6a52-1b64-4c4e-9a43-0d6a1c1f2b11";

describe("links", () => {
  test("the build page is the run's page and the user page is the attendees'", () => {
    assert.equal(buildPageUrl(BASE, RUN), `${BASE}/runs/${RUN}`);
    assert.equal(userPageUrl(BASE, RUN), `${BASE}/attend/${RUN}`);
  });

  test("the app's address drops a trailing slash and falls back to AUTH_URL", () => {
    assert.equal(appUrl({ APP_URL: `${BASE}/` }), BASE);
    assert.equal(appUrl({ AUTH_URL: BASE }), BASE);
    assert.equal(appUrl({ APP_URL: "  " }), null);
    assert.equal(appUrl({}), null);
  });
});

describe("the creator's notices", () => {
  test("started links to the build page", () => {
    const text = startedText("Kubernetes 101", buildPageUrl(BASE, RUN));
    assert.match(text, /underway/);
    assert.ok(text.includes(`<${BASE}/runs/${RUN}|`));
  });

  test("ready links to the user page", () => {
    const text = readyText("Kubernetes 101", userPageUrl(BASE, RUN));
    assert.match(text, /is ready/);
    assert.ok(text.includes(`<${BASE}/attend/${RUN}|`));
  });

  test("a name cannot become markup", () => {
    assert.equal(escapeSlack("A & B <!channel>"), "A &amp; B &lt;!channel&gt;");
    assert.ok(!startedText("<!channel>", BASE).includes("<!channel>"));
  });
});

describe("the failure alert", () => {
  const admins = [
    { email: "a@example.com", name: "Ada", slackUserId: "U1" },
    { email: "b@example.com", name: null, slackUserId: "U2" },
    { email: "c@example.com", name: "Cy", slackUserId: null },
  ];

  test("tags every administrator who has a Slack account and links the failed build", () => {
    const text = failedText("Kubernetes 101", "Pat", admins, buildPageUrl(BASE, RUN));
    assert.ok(text.includes("<@U1> <@U2>"));
    assert.ok(text.includes(`<${BASE}/runs/${RUN}|failed build page>`));
    assert.match(text, /created by Pat/);
  });

  test("names, rather than drops, an administrator who is not in Slack", () => {
    const text = failedText("Kubernetes 101", null, admins, BASE);
    assert.match(text, /Not in Slack, so not tagged: Cy\./);
    assert.ok(!text.includes("created by"));
  });
});
