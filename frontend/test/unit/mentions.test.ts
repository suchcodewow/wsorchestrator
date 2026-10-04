/** "@" tags in a comment: spotting one being typed, writing it in, and reading them back out. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { insertMention, matchesMention, mentionQueryAt, mentionSegments, mentionsIn } from "@/lib/mentions";

const ann = { email: "ann.lee@harness.io", fullName: "Ann Lee" };
const annie = { email: "ann@harness.io", fullName: "Ann" };
const bo = { email: "bo@harness.io", fullName: "Bo Chen" };

describe("mentionQueryAt", () => {
  test("finds the tag the caret is in", () => {
    assert.deepEqual(mentionQueryAt("hi @An", 6), { start: 3, query: "An" });
    assert.deepEqual(mentionQueryAt("@", 1), { start: 0, query: "" });
    assert.deepEqual(mentionQueryAt("ask @Ann Lee", 12), { start: 4, query: "Ann Lee" });
  });

  test("an email address is not a tag", () => {
    assert.equal(mentionQueryAt("mail ann@harness", 16), null);
  });

  test("a new line or a fourth word ends it", () => {
    assert.equal(mentionQueryAt("@Ann\nok", 7), null);
    assert.equal(mentionQueryAt("@one two three four", 19), null);
  });

  test("only what is before the caret counts", () => {
    assert.deepEqual(mentionQueryAt("@Ann Lee", 2), { start: 0, query: "A" });
    assert.equal(mentionQueryAt("no tag @Ann", 3), null);
  });
});

describe("insertMention", () => {
  test("replaces what was typed with the full name and a space, caret after it", () => {
    assert.deepEqual(insertMention("hi @an there", 3, 6, ann), { text: "hi @Ann Lee  there", caret: 12 });
  });
});

describe("mentionsIn", () => {
  test("keeps the people still named, once each", () => {
    assert.deepEqual(mentionsIn("@Ann Lee and @Ann Lee", [ann, ann, bo]), [ann]);
  });

  test("deleting a tag from the text untags that person", () => {
    assert.deepEqual(mentionsIn("@Bo Che", [bo]), []);
  });
});

describe("matchesMention", () => {
  test("any word of the name, or the email, from its start", () => {
    assert.ok(matchesMention(ann, "le"));
    assert.ok(matchesMention(ann, "ann l"));
    assert.ok(matchesMention(ann, "ann.lee@"));
    assert.ok(matchesMention(ann, ""));
    assert.ok(!matchesMention(ann, "ee"));
  });
});

describe("mentionSegments", () => {
  test("cuts the text into plain runs and tags", () => {
    assert.deepEqual(mentionSegments("ping @Bo Chen now", [bo]), [
      { text: "ping " },
      { text: "@Bo Chen", mention: bo },
      { text: " now" },
    ]);
  });

  test("the longest name wins, so @Ann Lee is not read as @Ann", () => {
    assert.deepEqual(mentionSegments("@Ann Lee, @Ann", [annie, ann]), [
      { text: "@Ann Lee", mention: ann },
      { text: ", " },
      { text: "@Ann", mention: annie },
    ]);
  });

  test("a name nobody was tagged by stays plain", () => {
    assert.deepEqual(mentionSegments("@Bo Chen", []), [{ text: "@Bo Chen" }]);
  });
});
