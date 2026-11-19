/**
 * The Bootcamp superlatives survey's pure rules: the standing list's ids, who
 * someone can vote for, which votes are kept, what a survey sent again keeps,
 * who leads a superlative, and where it is announced.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { cohortChannels } from "@/lib/cohorts/slack-plan";
import {
  SUPERLATIVES_CHANNEL_KIND,
  ballotFor,
  checkSuperlativeVotes,
  keptVotes,
  superlativeLeaders,
  superlativeListFrom,
  superlativeListSchema,
  superlativesAnnouncementText,
} from "@/lib/surveys/superlative-values";

const CLASS = [
  { email: "zoe@example.test", fullName: "Zoe Adams" },
  { email: "ana@example.test", fullName: "Ana Ruiz" },
  { email: "ben@example.test", fullName: "Ben Okafor" },
];
const SUPERLATIVES = [
  { id: "s1", title: "Most likely to close on the first call" },
  { id: "s2", title: "Best demo" },
];

describe("the standing list", () => {
  test("keeps each id, and gives one to a new superlative", () => {
    let n = 0;
    const list = superlativeListFrom({ superlatives: [{ id: "a", title: "One" }, { title: "Two" }] }, () => `new-${++n}`);
    assert.deepEqual(list, [
      { id: "a", title: "One" },
      { id: "new-1", title: "Two" },
    ]);
  });

  test("a repeated id is given a new one", () => {
    const list = superlativeListFrom({ superlatives: [{ id: "a", title: "One" }, { id: "a", title: "Two" }] }, () => "b");
    assert.deepEqual(
      list.map((x) => x.id),
      ["a", "b"],
    );
  });

  test("trims the wording, and refuses a blank one", () => {
    assert.equal(superlativeListSchema.parse({ superlatives: [{ title: "  Best demo " }] }).superlatives[0]!.title, "Best demo");
    assert.equal(superlativeListSchema.safeParse({ superlatives: [{ title: "   " }] }).success, false);
  });
});

describe("who someone can vote for", () => {
  test("everyone in the class but themselves, by name", () => {
    assert.deepEqual(
      ballotFor(CLASS, "ZOE@example.test").map((n) => n.fullName),
      ["Ana Ruiz", "Ben Okafor"],
    );
  });
});

describe("checking someone's votes", () => {
  const check = (votes: Record<string, string>) => checkSuperlativeVotes(SUPERLATIVES, CLASS, "zoe@example.test", { votes });

  test("keeps one lowercased vote per superlative", () => {
    assert.deepEqual(check({ s1: "ANA@example.test", s2: "ben@example.test" }), {
      ok: true,
      votes: { s1: "ana@example.test", s2: "ben@example.test" },
    });
  });

  test("a superlative left without a vote is named", () => {
    assert.deepEqual(check({ s1: "ana@example.test" }), { ok: false, error: { problem: "required", superlativeId: "s2" } });
  });

  test("a vote for themselves is refused", () => {
    assert.deepEqual(check({ s1: "zoe@example.test", s2: "ben@example.test" }), {
      ok: false,
      error: { problem: "self_vote", superlativeId: "s1" },
    });
  });

  test("a vote for someone outside the class is refused", () => {
    assert.deepEqual(check({ s1: "ana@example.test", s2: "stranger@example.test" }), {
      ok: false,
      error: { problem: "not_a_nominee", superlativeId: "s2" },
    });
  });

  test("a vote on a superlative the survey does not ask is refused", () => {
    assert.deepEqual(check({ s1: "ana@example.test", s2: "ben@example.test", s9: "ana@example.test" }), {
      ok: false,
      error: { problem: "unknown_superlative", superlativeId: "s9" },
    });
  });
});

describe("what a survey sent again keeps", () => {
  test("every vote that still fits, complete", () => {
    assert.deepEqual(keptVotes({ s1: "ana@example.test", s2: "ben@example.test" }, SUPERLATIVES, CLASS), {
      votes: { s1: "ana@example.test", s2: "ben@example.test" },
      complete: true,
    });
  });

  test("drops a vote for a superlative removed or a classmate gone, and asks again", () => {
    const now = [SUPERLATIVES[0]!, { id: "s3", title: "New one" }];
    assert.deepEqual(keptVotes({ s1: "gone@example.test", s2: "ben@example.test" }, now, CLASS), { votes: {}, complete: false });
    assert.deepEqual(keptVotes({ s1: "ana@example.test", s2: "ben@example.test" }, now, CLASS), {
      votes: { s1: "ana@example.test" },
      complete: false,
    });
  });
});

describe("who leads a superlative", () => {
  const standing = (email: string, votes: number) => ({ email, fullName: email, votes });

  test("the one with the most votes", () => {
    assert.deepEqual(superlativeLeaders([standing("a", 3), standing("b", 1)]), [standing("a", 3)]);
  });

  test("every one of them on a tie", () => {
    assert.deepEqual(superlativeLeaders([standing("a", 2), standing("b", 2), standing("c", 1)]), [standing("a", 2), standing("b", 2)]);
  });

  test("no one before anyone has voted", () => {
    assert.deepEqual(superlativeLeaders([]), []);
  });
});

describe("where the superlatives are announced", () => {
  test("the Bootcamp's sales- channel, which holds its Engineers too", () => {
    const channel = cohortChannels("2026-11-02", true, null).find((c) => c.kind === SUPERLATIVES_CHANNEL_KIND);
    assert.equal(channel?.name, "sales-bootcamp-nov-2026");
  });

  test("the message links to /intake", () => {
    assert.match(superlativesAnnouncementText("https://example.test/intake"), /<https:\/\/example\.test\/intake\|complete it here>/);
  });
});
