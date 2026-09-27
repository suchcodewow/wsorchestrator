/**
 * The `{{project}}`-style blanks in a lab guide, and the cookie that says whose
 * values fill them.
 *
 * An attendee copies commands straight out of a guide, so a blank filled with
 * the wrong thing is a command run against the wrong project, and a blank that
 * silently vanishes is a command that fails with no hint why. The cookie is
 * written by the browser and read by the server, so it is untrusted input: a
 * hand-edited or truncated one must fall back to nothing, never to a half-read
 * context or a value outside the known variables.
 *
 * What these tests pin:
 * - A token is replaced only when its name is a variable with a non-empty value;
 *   anything else is left standing and tallied as missing or unknown.
 * - Values are inserted literally, whatever `$` patterns they contain.
 * - `parseGuideContext` accepts only a UUID run, a positive integer account and
 *   known, non-blank, bounded typed values, and survives any malformed cookie.
 * - What `writeGuideContextCookie` writes, `parseGuideContext` reads back.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_GUIDE_CONTEXT,
  GUIDE_CONTEXT_COOKIE,
  GUIDE_VARIABLES,
  clearGuideContextCookie,
  exampleGuideValues,
  fillGuideVariables,
  guideVariable,
  isGuideVariable,
  newTally,
  parseGuideContext,
  tallied,
  writeGuideContextCookie,
} from "@/lib/guide-variables";

const RUN = "3f2b8c1e-9d4a-4e6b-8a7c-1d2e3f4a5b6c";

const cookie = (value: unknown) => encodeURIComponent(JSON.stringify(value));

describe("the variable list", () => {
  test("names are unique and each can be written as a token", () => {
    const names = GUIDE_VARIABLES.map((v) => v.name);
    assert.equal(new Set(names).size, names.length);
    for (const name of names) {
      assert.equal(fillGuideVariables(`{{${name}}}`, { [name]: "X" }), "X", name);
    }
  });

  test("every variable has a label, a hint and an example", () => {
    for (const v of GUIDE_VARIABLES) {
      assert.ok(v.label.length > 0 && v.hint.length > 0 && v.example.length > 0, v.name);
    }
  });

  test("the example links agree with the example identifiers", () => {
    // An author previewing a guide sees these side by side; they should describe
    // one plausible attendee, not three.
    const ex = exampleGuideValues();
    assert.ok(ex.projectUrl?.includes(`/account/${ex.account}/`));
    assert.ok(ex.projectUrl?.includes(`/orgs/${ex.org}/projects/${ex.project}/`));
    assert.ok(ex.orgUrl?.includes(`/account/${ex.account}/`));
    assert.ok(ex.orgUrl?.includes(`/organizations/${ex.org}/`));
  });

  test("isGuideVariable accepts exactly the listed names", () => {
    assert.equal(isGuideVariable("project"), true);
    assert.equal(isGuideVariable("projectUrl"), true);
    for (const bad of ["Project", "project ", "", "constructor", "__proto__", "toString"]) {
      assert.equal(isGuideVariable(bad), false, JSON.stringify(bad));
    }
  });

  test("guideVariable looks a variable up by name", () => {
    assert.equal(guideVariable("awsRegion").label, "AWS region");
  });
});

describe("fillGuideVariables", () => {
  test("returns text with no tokens untouched", () => {
    const text = "echo {not a token} and { {project} }";
    assert.equal(fillGuideVariables(text, { project: "p" }), text);
  });

  test("replaces every occurrence, with or without inner spaces", () => {
    assert.equal(
      fillGuideVariables("{{project}}/{{ project }}/{{  project}}", { project: "p" }),
      "p/p/p",
    );
  });

  test("matches the whole name, so projectUrl is not project + Url", () => {
    assert.equal(
      fillGuideVariables("{{projectUrl}} {{project}}", { project: "p", projectUrl: "https://u" }),
      "https://u p",
    );
  });

  test("leaves a blank or empty value standing and tallies it missing", () => {
    const tally = newTally();
    assert.equal(fillGuideVariables("{{org}} {{project}}", { project: "" }, tally), "{{org}} {{project}}");
    assert.deepEqual(tallied(tally), { used: ["org", "project"], missing: ["org", "project"], unknown: [] });
  });

  test("leaves a name that is not a variable standing and tallies it unknown", () => {
    const tally = newTally();
    assert.equal(fillGuideVariables("{{projct}} {{Project}}", { project: "p" }, tally), "{{projct}} {{Project}}");
    assert.deepEqual(tallied(tally), { used: [], missing: [], unknown: ["projct", "Project"] });
  });

  test("ignores things shaped almost like tokens", () => {
    const tally = newTally();
    const text = "{{1project}} {{project-name}} {{}} {project}";
    assert.equal(fillGuideVariables(text, { project: "p" }, tally), text);
    assert.deepEqual(tallied(tally), { used: [], missing: [], unknown: [] });
  });

  test("tallies each name once however often it appears", () => {
    const tally = newTally();
    fillGuideVariables("{{email}} {{email}} {{nope}} {{nope}}", {}, tally);
    fillGuideVariables("{{email}}", { email: "a@b.c" }, tally);
    assert.deepEqual(tallied(tally), { used: ["email"], missing: ["email"], unknown: ["nope"] });
  });

  test("inserts a value literally, $ patterns and all", () => {
    assert.equal(fillGuideVariables("x {{project}} y", { project: "$&$1$$`'" }), "x $&$1$$`' y");
  });

  test("does not re-expand a value that itself looks like a token", () => {
    assert.equal(
      fillGuideVariables("{{project}}", { project: "{{org}}", org: "o" }),
      "{{org}}",
    );
  });

  test("a triple brace keeps its outer braces", () => {
    assert.equal(fillGuideVariables("{{{project}}}", { project: "p" }), "{p}");
  });

  test("works without a tally", () => {
    assert.equal(fillGuideVariables("{{nope}} {{org}}", {}), "{{nope}} {{org}}");
  });
});

describe("exampleGuideValues", () => {
  test("has a non-empty value for every variable", () => {
    const ex = exampleGuideValues();
    for (const v of GUIDE_VARIABLES) assert.equal(ex[v.name], v.example);
    assert.equal(Object.keys(ex).length, GUIDE_VARIABLES.length);
  });

  test("fills a guide completely", () => {
    const text = GUIDE_VARIABLES.map((v) => `{{${v.name}}}`).join(" ");
    const tally = newTally();
    assert.doesNotMatch(fillGuideVariables(text, exampleGuideValues(), tally), /\{\{/);
    assert.deepEqual(tallied(tally).missing, []);
  });
});

describe("parseGuideContext", () => {
  test("is empty for no cookie", () => {
    assert.deepEqual(parseGuideContext(undefined), EMPTY_GUIDE_CONTEXT);
    assert.deepEqual(parseGuideContext(""), EMPTY_GUIDE_CONTEXT);
  });

  test("reads a well-formed cookie", () => {
    assert.deepEqual(
      parseGuideContext(cookie({ runId: RUN, accountId: 7, typed: { project: "p", email: "e@x.example" } })),
      { runId: RUN, accountId: 7, typed: { project: "p", email: "e@x.example" } },
    );
  });

  test("is empty for a cookie that is not JSON, or not URI-decodable", () => {
    for (const raw of ["not json", "%7B", "%E0%A4%A", "{\"runId\":", "%"]) {
      assert.deepEqual(parseGuideContext(raw), EMPTY_GUIDE_CONTEXT, raw);
    }
  });

  test("is empty for JSON that is not an object", () => {
    for (const value of [null, 1, "s", true]) {
      assert.deepEqual(parseGuideContext(cookie(value)), EMPTY_GUIDE_CONTEXT, JSON.stringify(value));
    }
  });

  test("an array reads as an empty context", () => {
    assert.deepEqual(parseGuideContext(cookie([RUN, 7])), EMPTY_GUIDE_CONTEXT);
  });

  test("drops a run id that is not a UUID", () => {
    for (const runId of ["", "abc", `${RUN}x`, ` ${RUN}`, "'; drop table x; --", 5, null]) {
      assert.equal(parseGuideContext(cookie({ runId })).runId, null, JSON.stringify(runId));
    }
  });

  test("accepts an upper-case UUID", () => {
    assert.equal(parseGuideContext(cookie({ runId: RUN.toUpperCase() })).runId, RUN.toUpperCase());
  });

  test("drops an account id that is not a positive integer", () => {
    for (const accountId of [0, -1, 1.5, "7", NaN, null, 1e400]) {
      assert.equal(parseGuideContext(cookie({ accountId })).accountId, null, String(accountId));
    }
    assert.equal(parseGuideContext(cookie({ accountId: 1 })).accountId, 1);
  });

  test("keeps only known variables with string values", () => {
    const typed = parseGuideContext(
      cookie({ typed: { project: "p", nope: "x", org: 5, email: null, __proto__: "x", constructor: "c" } }),
    ).typed;
    assert.deepEqual(typed, { project: "p" });
    assert.equal(Object.getPrototypeOf(typed), Object.prototype);
  });

  test("a __proto__ key in the JSON cannot pollute the result", () => {
    const raw = encodeURIComponent('{"typed":{"__proto__":{"project":"evil"}}}');
    const typed = parseGuideContext(raw).typed;
    assert.equal(typed.project, undefined);
    assert.equal(({} as Record<string, unknown>).project, undefined);
  });

  test("trims typed values and drops blank ones", () => {
    assert.deepEqual(
      parseGuideContext(cookie({ typed: { project: "  p  ", org: "   ", email: "" } })).typed,
      { project: "p" },
    );
  });

  test("cuts a typed value to 300 characters", () => {
    const long = "a".repeat(400);
    assert.equal(parseGuideContext(cookie({ typed: { projectUrl: long } })).typed.projectUrl?.length, 300);
    const exact = "b".repeat(300);
    assert.equal(parseGuideContext(cookie({ typed: { projectUrl: exact } })).typed.projectUrl, exact);
  });

  test("a typed field that is not an object reads as nothing typed", () => {
    for (const typed of [null, "project", 3, ["p"]]) {
      assert.deepEqual(parseGuideContext(cookie({ runId: RUN, typed })).typed, {}, JSON.stringify(typed));
    }
  });

  test("one bad field does not spoil the others", () => {
    assert.deepEqual(parseGuideContext(cookie({ runId: "bad", accountId: 3, typed: { org: "o" } })), {
      runId: null,
      accountId: 3,
      typed: { org: "o" },
    });
  });
});

describe("the cookie in the browser", () => {
  const g = globalThis as { document?: unknown };
  let saved: unknown;
  let jar: { cookie: string };

  beforeEach(() => {
    saved = g.document;
    jar = { cookie: "" };
    g.document = jar;
  });
  afterEach(() => {
    if (saved === undefined) delete g.document;
    else g.document = saved;
  });

  const valueOf = (written: string) => {
    const [pair] = written.split(";");
    const eq = pair.indexOf("=");
    assert.equal(pair.slice(0, eq), GUIDE_CONTEXT_COOKIE);
    return pair.slice(eq + 1);
  };

  test("is written site-wide for a year, lax", () => {
    writeGuideContextCookie({ runId: RUN, accountId: 2, typed: {} });
    assert.match(jar.cookie, /; path=\/; max-age=31536000; samesite=lax$/);
  });

  test("reads back as what was written", () => {
    const context = { runId: RUN, accountId: 2, typed: { project: "shawn_pearson", workshop: "Acme; Summit, Day=1" } };
    writeGuideContextCookie(context);
    const value = valueOf(jar.cookie);
    // Separators in a value must be encoded, or they would end the cookie early.
    assert.doesNotMatch(value, /[;,\s]/);
    assert.deepEqual(parseGuideContext(value), context);
  });

  test("writes only what the server would accept", () => {
    writeGuideContextCookie({
      runId: null,
      accountId: null,
      typed: { project: "  p  ", org: "", nope: "x" } as never,
    });
    assert.deepEqual(JSON.parse(decodeURIComponent(valueOf(jar.cookie))), {
      runId: null,
      accountId: null,
      typed: { project: "p" },
    });
  });

  test("is cleared by expiring it", () => {
    clearGuideContextCookie();
    assert.equal(jar.cookie, `${GUIDE_CONTEXT_COOKIE}=; path=/; max-age=0; samesite=lax`);
  });
});
