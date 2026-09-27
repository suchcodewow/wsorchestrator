/**
 * The organization identifier a deploy derives from the name someone types.
 *
 * The deploy form previews this as the name is typed and `deployContent`
 * derives it again on the server, and the runner has its own copy that has to
 * agree (`runner/test/identifier.test.ts` checks the two against each other). A
 * slip here fails the deploy with whatever Harness says about a malformed
 * request, and only for the one name that happened to trip it — so most of
 * what follows checks Harness's own rule against every shape of name rather
 * than a handful of examples.
 *
 * What is pinned: the result always satisfies Harness's identifier regex, is at
 * most 128 characters, never starts with a digit or `$`, is never a reserved
 * word, and is null (rather than a made-up fallback) when nothing usable is
 * left — that null is what the form shows as "needs a letter, digit, or
 * underscore".
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { harnessIdentifier } from "@/lib/harness-identifier";

/** Harness's own rule for an entity identifier. */
const HARNESS_IDENTIFIER = /^[a-zA-Z_][0-9a-zA-Z_$]{0,127}$/;

/** Names organizers have used, then the shapes that break naive rules. */
const NAMES = [
  "aws cardinal",
  "azure cardinal",
  "aws platform team",
  "nationwide insurnace",
  "cloud-run-demo",
  "zone-b-dfae0a",
  "Status",
  "org",
  "PARALLEL",
  "2024 kickoff",
  "$$$",
  "café résumé",
  "  spaces  everywhere  ",
  "a",
  "team/platform & ops (q3)",
  "emoji 🎉 workshop",
  "Ünïcödé Wörkshöp",
  "x".repeat(200),
  "9".repeat(200),
  "$".repeat(200),
  "status".repeat(50),
  "a" + " -".repeat(100) + "b",
];

describe("harnessIdentifier", () => {
  describe("always produces something Harness accepts", () => {
    for (const name of NAMES) {
      test(JSON.stringify(name.slice(0, 40)), () => {
        const id = harnessIdentifier(name);
        assert.ok(id !== null, "a name with a letter or digit in it must yield an identifier");
        assert.match(id, HARNESS_IDENTIFIER);
        assert.ok(id.length <= 128, `${id.length} characters is over the cap`);
      });
    }
  });

  test("turns spaces, hyphens and punctuation into single underscores", () => {
    assert.equal(harnessIdentifier("aws cardinal"), "aws_cardinal");
    assert.equal(harnessIdentifier("cloud-run-demo"), "cloud_run_demo");
    assert.equal(harnessIdentifier("team/platform & ops (q3)"), "team_platform_ops_q3");
    assert.equal(harnessIdentifier("a - - - b"), "a_b");
    assert.equal(harnessIdentifier("a__b"), "a_b");
  });

  test("trims separators from both ends", () => {
    assert.equal(harnessIdentifier("  spaces  everywhere  "), "spaces_everywhere");
    assert.equal(harnessIdentifier("--demo--"), "demo");
    assert.equal(harnessIdentifier("__private"), "private");
  });

  test("keeps letters, digits, underscores and dollar signs as typed", () => {
    assert.equal(harnessIdentifier("Aws_Cardinal2"), "Aws_Cardinal2");
    assert.equal(harnessIdentifier("price$list"), "price$list");
  });

  test("folds accented and compatibility characters to plain ASCII", () => {
    assert.equal(harnessIdentifier("café résumé"), "cafe_resume");
    assert.equal(harnessIdentifier("Ünïcödé Wörkshöp"), "Unicode_Workshop");
    // NFKD also unpacks ligatures and full-width forms.
    assert.equal(harnessIdentifier("ﬁle"), "file");
    assert.equal(harnessIdentifier("ＡＢＣ"), "ABC");
  });

  test("drops characters with no ASCII form rather than guessing", () => {
    assert.equal(harnessIdentifier("emoji 🎉 workshop"), "emoji_workshop");
    assert.equal(harnessIdentifier("straße"), "stra_e");
  });

  test("prefixes an underscore when the result would start with a digit or $", () => {
    assert.equal(harnessIdentifier("2024 kickoff"), "_2024_kickoff");
    assert.equal(harnessIdentifier("1"), "_1");
    assert.equal(harnessIdentifier("$$$"), "_$$$");
    assert.equal(harnessIdentifier("$ave"), "_$ave");
  });

  test("suffixes reserved words, whatever their case", () => {
    for (const reserved of [
      "or", "and", "eq", "ne", "lt", "gt", "le", "ge", "div", "mod", "not",
      "null", "true", "false", "new", "var", "return", "step", "parallel",
      "stepgroup", "org", "account", "status", "liteenginetask", "notification",
    ]) {
      assert.equal(harnessIdentifier(reserved), `${reserved}_`, reserved);
    }
    assert.equal(harnessIdentifier("Status"), "Status_");
    assert.equal(harnessIdentifier("PARALLEL"), "PARALLEL_");
    assert.equal(harnessIdentifier("stepGroup"), "stepGroup_");
    assert.equal(harnessIdentifier("liteEngineTask"), "liteEngineTask_");
    assert.equal(harnessIdentifier(" org "), "org_");
  });

  test("does not suffix a reserved word that is only part of the name", () => {
    assert.equal(harnessIdentifier("status page"), "status_page");
    assert.equal(harnessIdentifier("organization"), "organization");
    assert.equal(harnessIdentifier("my org"), "my_org");
  });

  describe("the 128-character cap", () => {
    test("truncates a long name to 127 characters, leaving room for a prefix", () => {
      assert.equal(harnessIdentifier("x".repeat(200)), "x".repeat(127));
      assert.equal(harnessIdentifier("x".repeat(127)), "x".repeat(127));
      assert.equal(harnessIdentifier("x".repeat(128)), "x".repeat(127));
    });

    test("adds the digit prefix after truncating, so the result is exactly 128", () => {
      const id = harnessIdentifier("9".repeat(200));
      assert.equal(id, `_${"9".repeat(127)}`);
      assert.equal(id?.length, 128);
    });

    test("does not end on an underscore that truncation exposed", () => {
      // Character 127 is the separator before "b"; cutting there must not
      // leave a trailing underscore behind.
      const id = harnessIdentifier(`${"a".repeat(126)} b`);
      assert.equal(id, "a".repeat(126));
    });
  });

  test("is null when nothing usable is left", () => {
    for (const empty of ["", " ", "   ", "---", "___", "///", "🎉", "ß", "\n\t"]) {
      assert.equal(harnessIdentifier(empty), null, JSON.stringify(empty));
    }
  });

  test("is stable, and an identifier it produced maps to itself", () => {
    // The form's preview and the server's derivation both call this on the
    // typed name; someone who pastes the previewed identifier back in must get
    // the same organization.
    for (const name of NAMES) {
      const id = harnessIdentifier(name);
      assert.equal(harnessIdentifier(name), id);
      if (id !== null) assert.equal(harnessIdentifier(id), id, JSON.stringify(name));
    }
  });
});
