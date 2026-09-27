/**
 * The colour scheme: the preference, the cookie, and the inline script that
 * paints the first frame.
 *
 * The script runs before React, from a string the server builds, so a mistake
 * in it is a white flash for every dark-mode user on every page load and is
 * invisible to the type checker. The tests below execute the script against a
 * fake `document` and `window` and check the class and color-scheme it sets
 * for every combination of stored preference and remembered cookie — the
 * cookie matters because it is what lets a "system" user get the right scheme
 * without waiting on `matchMedia`.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { ThemePreference } from "@/db/schema";
import {
  DARK_CLASS,
  DARK_QUERY,
  THEME_COOKIE,
  applyTheme,
  isDark,
  parseScheme,
  themeScript,
  type ResolvedScheme,
} from "@/lib/theme";

type FakeEnv = {
  document: {
    cookie: string;
    documentElement: { classList: { toggle: (c: string, on: boolean) => void; has: (c: string) => boolean }; style: { colorScheme: string } };
  };
  window: { matchMedia: (q: string) => { matches: boolean } };
  queries: string[];
};

function fakeEnv(systemDark: boolean): FakeEnv {
  const classes = new Set<string>();
  const queries: string[] = [];
  return {
    document: {
      cookie: "",
      documentElement: {
        classList: {
          toggle: (c, on) => void (on ? classes.add(c) : classes.delete(c)),
          has: (c) => classes.has(c),
        },
        style: { colorScheme: "" },
      },
    },
    window: {
      matchMedia: (q) => {
        queries.push(q);
        return { matches: systemDark };
      },
    },
    queries,
  };
}

function runScript(preference: ThemePreference, cookie: ResolvedScheme | null, systemDark: boolean) {
  const env = fakeEnv(systemDark);
  new Function("document", "window", themeScript(preference, cookie))(env.document, env.window);
  return {
    dark: env.document.documentElement.classList.has(DARK_CLASS),
    colorScheme: env.document.documentElement.style.colorScheme,
    queried: env.queries,
  };
}

describe("parseScheme", () => {
  test("accepts exactly dark and light", () => {
    assert.equal(parseScheme("dark"), "dark");
    assert.equal(parseScheme("light"), "light");
  });

  test("anything else is no remembered scheme", () => {
    for (const v of [undefined, "", "system", "Dark", " dark", "true"]) {
      assert.equal(parseScheme(v), null, String(v));
    }
  });
});

describe("themeScript", () => {
  const cases: Array<[ThemePreference, ResolvedScheme | null, boolean, boolean]> = [
    // preference, cookie, system is dark, expected dark
    ["dark", null, false, true],
    ["dark", "light", false, true],
    ["light", null, true, false],
    ["light", "dark", true, false],
    ["system", "dark", false, true],
    ["system", "light", true, false],
    ["system", null, true, true],
    ["system", null, false, false],
  ];

  for (const [preference, cookie, systemDark, expected] of cases) {
    test(`preference=${preference} cookie=${cookie} system=${systemDark ? "dark" : "light"} → ${expected ? "dark" : "light"}`, () => {
      const got = runScript(preference, cookie, systemDark);
      assert.equal(got.dark, expected);
      assert.equal(got.colorScheme, expected ? "dark" : "light");
    });
  }

  test("an explicit preference or a remembered cookie never consults matchMedia", () => {
    assert.deepEqual(runScript("dark", null, false).queried, []);
    assert.deepEqual(runScript("light", null, true).queried, []);
    assert.deepEqual(runScript("system", "dark", false).queried, []);
  });

  test("system with no cookie asks the prefers-color-scheme query", () => {
    assert.deepEqual(runScript("system", null, true).queried, [DARK_QUERY]);
  });

  test("swallows errors rather than breaking the page", () => {
    const script = themeScript("system", null);
    assert.doesNotThrow(() => new Function("document", "window", script)(undefined, undefined));
  });

  test("is a single self-invoking expression", () => {
    const script = themeScript("dark", "dark");
    assert.match(script, /^\(function\(\)\{/);
    assert.match(script, /\}\)\(\);$/);
  });
});

describe("isDark and applyTheme", () => {
  const g = globalThis as { window?: unknown; document?: unknown };
  let savedWindow: unknown;
  let savedDocument: unknown;
  beforeEach(() => {
    savedWindow = g.window;
    savedDocument = g.document;
  });
  afterEach(() => {
    if (savedWindow === undefined) delete g.window;
    else g.window = savedWindow;
    if (savedDocument === undefined) delete g.document;
    else g.document = savedDocument;
  });

  test("explicit preferences need no window", () => {
    delete g.window;
    assert.equal(isDark("dark"), true);
    assert.equal(isDark("light"), false);
  });

  test("system is light on the server, where there is no window", () => {
    delete g.window;
    assert.equal(isDark("system"), false);
  });

  test("system follows prefers-color-scheme in the browser", () => {
    g.window = fakeEnv(true).window;
    assert.equal(isDark("system"), true);
    g.window = fakeEnv(false).window;
    assert.equal(isDark("system"), false);
  });

  test("applyTheme sets the class, the color-scheme and the resolved-scheme cookie", () => {
    const env = fakeEnv(true);
    g.window = env.window;
    g.document = env.document;

    applyTheme("system");
    assert.equal(env.document.documentElement.classList.has(DARK_CLASS), true);
    assert.equal(env.document.documentElement.style.colorScheme, "dark");
    assert.equal(env.document.cookie, `${THEME_COOKIE}=dark; path=/; max-age=31536000; samesite=lax`);

    applyTheme("light");
    assert.equal(env.document.documentElement.classList.has(DARK_CLASS), false);
    assert.equal(env.document.documentElement.style.colorScheme, "light");
    assert.equal(env.document.cookie, `${THEME_COOKIE}=light; path=/; max-age=31536000; samesite=lax`);
  });

  test("the cookie applyTheme writes is one parseScheme reads back", () => {
    const env = fakeEnv(false);
    g.window = env.window;
    g.document = env.document;
    applyTheme("dark");
    const value = env.document.cookie.split(";")[0]!.split("=")[1];
    assert.equal(parseScheme(value), "dark");
  });
});
