/**
 * The lab guide renderer: author Markdown in, HTML out, shown to every attendee
 * of every event.
 *
 * It matters twice over. A guide is written by one person and read by hundreds,
 * so the sanitizer is the only thing standing between an author's typo — or a
 * pasted snippet, or a malicious contributor — and script running in an
 * attendee's signed-in session. And a guide is followed step by step with a
 * terminal open, so a code block that falls out of its list item, a `{{project}}`
 * that stays blank, or a callout that renders as `:::note` is a lab that stops
 * working in the room.
 *
 * What these tests pin:
 * - Raw HTML, script URLs and event handlers never survive, however they are
 *   smuggled in: typed, entity-encoded, through a directive's attributes, a code
 *   block's title, or a reader's own `{{variable}}` value.
 * - Callouts and `:::details`, with their titles, aliases and fallbacks; any
 *   other directive shows as the text the author typed.
 * - `{{variables}}` fill as literal text in prose, code and links, and the report
 *   of which were used, missing or misspelt.
 * - Headings get stable, de-duplicated ids and a table of contents of h2/h3.
 * - Code blocks get a language label, an optional title, and per-line copy
 *   buttons; list items keep their fenced code even when under-indented.
 * - `labImageRefs` finds the library images a guide shows, and only those.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { labImageRefs, renderMarkdown } from "@/lib/markdown";
import type { GuideValues } from "@/lib/guide-variables";

const IMG = "11111111-1111-4111-8111-111111111111";
const IMG2 = "22222222-2222-4222-8222-222222222222";

async function html(
  markdown: string,
  options?: Parameters<typeof renderMarkdown>[1],
): Promise<string> {
  return (await renderMarkdown(markdown, options)).html;
}

/** The HTML with the icon SVGs and copy buttons collapsed, for readable asserts. */
const plain = (s: string) =>
  s
    .replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>")
    .replace(/<button[\s\S]*?<\/button>/g, "<button/>")
    .replace(/ style="[^"]*"/g, "");

/** Nothing that runs: no script-bearing tags, handlers or script URLs. */
function assertInert(out: string, label: string) {
  assert.doesNotMatch(out, /<(script|iframe|object|embed|style|form|input|meta|link|base)\b/i, label);
  // Inside a tag only: escaped text that reads `onerror=` is harmless.
  assert.doesNotMatch(out, /<[^>]*\son[a-z]+\s*=/i, label);
  assert.doesNotMatch(out, /<[^>]*(href|src)="\s*(javascript|vbscript|data):/i, label);
}

describe("empty input", () => {
  test("renders nothing, with no contents and no variables", async () => {
    for (const blank of ["", "   ", "\n\n\t\n"]) {
      assert.deepEqual(await renderMarkdown(blank), {
        html: "",
        toc: [],
        variables: { used: [], missing: [], unknown: [] },
      });
    }
  });
});

describe("sanitizing", () => {
  const HOSTILE: [string, string][] = [
    ["script tag", "<script>alert(1)</script>"],
    ["img onerror", '<img src=x onerror="alert(1)">'],
    ["svg onload", "<svg onload=alert(1)></svg>"],
    ["iframe", '<iframe src="https://evil.example"></iframe>'],
    ["style tag", "<style>body{display:none}</style>"],
    ["inline html link with handler", '<a href="https://x.example" onclick="alert(1)">z</a>'],
    ["form", '<form action="https://evil.example"><input name="p"></form>'],
    ["javascript link", "[x](javascript:alert(1))"],
    ["mixed-case javascript link", "[x](JaVaScRiPt:alert(1))"],
    ["entity-encoded javascript link", "[x](java&#x73;cript:alert(1))"],
    ["vbscript link", "[x](vbscript:msgbox(1))"],
    ["data: link", "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"],
    ["javascript image", "![x](javascript:alert(1))"],
    ["javascript autolink", "<javascript:alert(1)>"],
    ["javascript reference definition", "[x][r]\n\n[r]: javascript:alert(1)"],
    ["directive handler attribute", ':::note{onclick="alert(1)" style="x"}\nbody\n:::'],
    ["details handler attribute", ':::details{open ontoggle="alert(1)"}\nbody\n:::'],
    ["unknown directive with html", ":::bogus\n<script>alert(1)</script>\n:::"],
    ["code title with html", '```bash title="<img src=x onerror=alert(1)>"\necho\n```'],
  ];

  for (const [label, md] of HOSTILE) {
    test(`neutralises: ${label}`, async () => {
      assertInert(await html(md), label);
    });
  }

  test("drops raw HTML altogether rather than escaping it into view", async () => {
    assert.equal(await html("<div>hi</div>"), "");
    assert.equal(await html('<div data-callout="note">x</div>'), "");
  });

  test("a stripped link keeps its text", async () => {
    assert.equal(await html("[click me](javascript:alert(1))"), "<p><a>click me</a></p>");
  });

  test("an unknown directive's html shows as escaped text", async () => {
    const out = await html(":::bogus\n<script>alert(1)</script>\n:::");
    assert.match(out, /&#x3C;script>alert\(1\)&#x3C;\/script>/);
  });

  test("directive attributes other than open do not reach the page", async () => {
    const out = await html(':::note{class="evil" id="x" data-x="1"}\nbody\n:::');
    assert.doesNotMatch(out, /evil|id="x"|data-x/);
  });

  test("a code block's title is text, never markup", async () => {
    const out = await html('```bash title="<b>bold</b>"\necho\n```');
    assert.match(out, /<span class="lab-code-title">&#x3C;b>bold&#x3C;\/b><\/span>/);
  });
});

describe("guide variables", () => {
  const values: GuideValues = {
    project: "shawn_pearson",
    projectUrl: "https://app.harness.io/ng/account/a/home/orgs/o/projects/p/details",
  };

  test("fill prose, inline code and fenced code", async () => {
    const out = await html("Project {{project}}, `{{project}}`\n\n```bash\necho {{project}}\n```", {
      values,
    });
    assert.match(out, /<p>Project shawn_pearson, <code data-copy="inline">shawn_pearson<\/code><\/p>/);
    assert.match(out, /shawn_pearson<\/span>/);
    assert.doesNotMatch(out, /\{\{project\}\}/);
  });

  test("fill a link's href, a reference definition and an image's alt", async () => {
    const out = await html(
      `[open]({{projectUrl}}) [ref][d] ![{{project}}](/pic.png)\n\n[d]: {{projectUrl}}`,
      { values },
    );
    assert.equal((out.match(/href="https:\/\/app\.harness\.io/g) ?? []).length, 2);
    assert.match(out, /alt="shawn_pearson"/);
  });

  test("an underscored value stays literal, never emphasis", async () => {
    // Filling the tree rather than the source is what keeps `_pearson and shawn_`
    // from pairing up into <em>.
    const out = await html("{{project}} and {{project}}", { values: { project: "_a_b_" } });
    assert.equal(out, "<p>_a_b_ and _a_b_</p>");
  });

  test("a hostile value lands as escaped text", async () => {
    const out = await html("{{project}} `{{project}}`", {
      values: { project: "<img src=x onerror=alert(1)>" },
    });
    assertInert(out, "value");
    assert.match(out, /&#x3C;img src=x onerror=alert\(1\)>/);
  });

  test("a script URL as a value is stripped from the link like any other", async () => {
    const out = await html("[go]({{projectUrl}}) ![i]({{projectUrl}})", {
      values: { projectUrl: "javascript:alert(1)" },
    });
    assertInert(out, "projectUrl");
    assert.equal(out, '<p><a>go</a> <img alt="i"></p>');
  });

  test("fill a code block's title", async () => {
    const out = await html("```bash title={{project}}\nx\n```", { values: { project: "p1" } });
    assert.match(out, /<span class="lab-code-title">p1<\/span>/);
  });

  test("report which were used, which stayed blank, and which are not variables", async () => {
    const { variables, html: out } = await renderMarkdown(
      "{{project}} {{ org }} {{nope}} {{Project}} {{project}}",
      { values: { project: "p" } },
    );
    assert.deepEqual(variables, {
      used: ["project", "org"],
      missing: ["org"],
      unknown: ["nope", "Project"],
    });
    // Blanks and typos stay standing so the page shows what it is waiting for.
    assert.equal(out, "<p>p {{ org }} {{nope}} {{Project}} p</p>");
  });

  test("with no values, every variable is missing", async () => {
    const { variables } = await renderMarkdown("{{project}} {{email}}");
    assert.deepEqual(variables, { used: ["project", "email"], missing: ["project", "email"], unknown: [] });
  });
});

describe("headings and the table of contents", () => {
  test("h2 and h3 get ids, anchors and a contents entry; h1 and h4 do not", async () => {
    const r = await renderMarkdown("# Title\n\n## Set up\n\n### Sub *step*\n\n#### Deep");
    assert.match(r.html, /<h1>Title<\/h1>/);
    assert.match(r.html, /<h2 id="set-up"><a href="#set-up" class="heading-anchor">Set up<\/a><\/h2>/);
    assert.match(r.html, /<h3 id="sub-step"><a href="#sub-step" class="heading-anchor">Sub <em>step<\/em><\/a><\/h3>/);
    assert.match(r.html, /<h4>Deep<\/h4>/);
    assert.deepEqual(r.toc, [
      { id: "set-up", text: "Set up", depth: 2 },
      { id: "sub-step", text: "Sub step", depth: 3 },
    ]);
  });

  test("repeated headings get distinct ids", async () => {
    const r = await renderMarkdown("## Verify\n\n## Verify\n\n### Verify");
    assert.deepEqual(
      r.toc.map((t) => t.id),
      ["verify", "verify-1", "verify-2"],
    );
  });

  test("an empty heading still gets an id", async () => {
    const r = await renderMarkdown("##\n\n## Next");
    assert.deepEqual(r.toc[0], { id: "section", text: "", depth: 2 });
  });

  test("ids restart for every render", async () => {
    await renderMarkdown("## Again");
    const r = await renderMarkdown("## Again");
    assert.equal(r.toc[0]?.id, "again");
  });

  test("code in a heading is not click-to-copy, so the anchor still works", async () => {
    const out = await html("## Run `make`");
    assert.match(out, /<a href="#run-make" class="heading-anchor">Run <code>make<\/code><\/a>/);
  });
});

describe("links", () => {
  test("off-site links open in a new tab without an opener", async () => {
    const out = await html("[a](https://x.example) [b](http://y.example)");
    assert.equal(
      (out.match(/target="_blank" rel="noopener noreferrer"/g) ?? []).length,
      2,
    );
  });

  test("relative, anchor and mailto links stay in place", async () => {
    const out = await html("[b](/rel) [c](#here) [d](mailto:a@b.example)");
    assert.doesNotMatch(out, /target=/);
    assert.match(out, /href="\/rel"/);
    assert.match(out, /href="#here"/);
    assert.match(out, /href="mailto:a@b.example"/);
  });

  test("an upper-case scheme is still a link", async () => {
    assert.match(await html("[d](HTTPS://X.EXAMPLE)"), /href="HTTPS:\/\/X\.EXAMPLE"/);
  });

  test("inline code in a link is left alone; elsewhere it is click-to-copy", async () => {
    const out = await html("[`code`](https://x.example) and `loose`");
    assert.match(out, /<a [^>]*><code>code<\/code><\/a>/);
    assert.match(out, /<code data-copy="inline">loose<\/code>/);
  });
});

describe("callouts", () => {
  const KINDS: [string, string, string][] = [
    ["note", "note", "Note"],
    ["tip", "tip", "Tip"],
    ["success", "success", "Success"],
    ["warning", "warning", "Warning"],
    ["danger", "danger", "Caution"],
    ["info", "note", "Note"],
    ["important", "note", "Note"],
    ["caution", "danger", "Caution"],
    ["error", "danger", "Caution"],
    ["warn", "warning", "Warning"],
    ["check", "success", "Success"],
  ];

  for (const [name, kind, title] of KINDS) {
    test(`:::${name} is a ${kind} callout titled "${title}"`, async () => {
      const out = plain(await html(`:::${name}\nbody\n:::`));
      assert.equal(
        out,
        `<div data-callout="${kind}" class="lab-callout"><p class="lab-callout-head"><svg/>` +
          `<span class="lab-callout-title">${title}</span></p>` +
          `<div class="lab-callout-body"><p>body</p></div></div>`,
      );
    });
  }

  test("takes a title written after the name", async () => {
    const out = await html(":::warning Mind the bill\nText\n:::");
    assert.match(out, /<span class="lab-callout-title">Mind the bill<\/span>/);
  });

  test("takes a title in brackets, with formatting", async () => {
    const out = await html(":::tip[Use *this*]\nText\n:::");
    assert.match(out, /<span class="lab-callout-title">Use <em>this<\/em><\/span>/);
  });

  test("keeps brackets and backslashes in a plain title literally", async () => {
    const out = await html(":::note See [docs] \\ here\nx\n:::");
    assert.match(out, /<span class="lab-callout-title">See \[docs\] \\ here<\/span>/);
  });

  test("a callout with only a title has no body", async () => {
    const out = await html(":::tip Only a title\n:::");
    assert.doesNotMatch(out, /lab-callout-body/);
  });

  test("a callout keeps block content: lists and code", async () => {
    const out = await html(":::note\n- one\n- two\n\n```bash\nls\n```\n:::");
    assert.match(out, /lab-callout-body"><ul>/);
    assert.match(out, /<figure class="lab-code" data-lang="bash">/);
  });

  test("an upper-case name is a callout too", async () => {
    const out = await html(":::NOTE Upper\nx\n:::");
    assert.match(out, /data-callout="note"/);
  });

  test("a directive-looking line inside a code fence is left as written", async () => {
    for (const fence of ["```", "~~~"]) {
      const out = await html(`${fence}text\n:::note Title\n${fence}`);
      assert.match(out, /:::note Title/);
      assert.doesNotMatch(out, /:::note\[Title\]|data-callout/);
    }
  });
});

describe("details", () => {
  test("defaults its summary to Details, and is closed", async () => {
    const out = plain(await html(":::details\nhidden\n:::"));
    assert.equal(
      out,
      '<details class="lab-details"><summary class="lab-details-summary"><svg/>' +
        '<span class="lab-details-title">Details</span></summary>' +
        '<div class="lab-details-body"><p>hidden</p></div></details>',
    );
  });

  test("takes a summary after the name or in brackets", async () => {
    assert.match(await html(":::details Show me\nx\n:::"), /lab-details-title">Show me</);
    assert.match(await html(":::details[Show *me*]\nx\n:::"), /lab-details-title">Show <em>me<\/em></);
  });

  test("{open} starts it unfolded", async () => {
    assert.match(await html(":::details{open}\nx\n:::"), /<details open class="lab-details">/);
  });
});

describe("other directives", () => {
  test("an unknown container shows as the text the author typed", async () => {
    assert.equal(await html(":::bogus\nx\n:::"), ":::bogus\nx\n:::");
  });

  test("leaf and text directives show as typed", async () => {
    assert.equal(await html("::leaf"), "::leaf");
    // A colon in ordinary prose parses as a text directive; it must read as typed.
    assert.equal(await html("See docs:here and :smile: now"), "<p>See docs:here and :smile: now</p>");
    assert.equal(await html("Starts at 10:30am"), "<p>Starts at 10:30am</p>");
  });
});

describe("code blocks", () => {
  test("a single line has a label and a copy button but no line numbers", async () => {
    const out = plain(await html("```bash\necho hi\n```"));
    assert.match(out, /^<figure class="lab-code" data-lang="bash"><figcaption class="lab-code-head">/);
    assert.match(out, /<span class="lab-code-title">Shell<\/span><button\/><\/figcaption>/);
    assert.doesNotMatch(out, /has-line-numbers/);
  });

  test("several lines are numbered, with a copy button per line and none on a blank", async () => {
    const out = await html("```text\na\n\nb\n```");
    assert.match(out, /has-line-numbers/);
    assert.match(out, /aria-label="Copy line 1"/);
    assert.doesNotMatch(out, /aria-label="Copy line 2"/);
    assert.match(out, /class="code-line-copy is-blank"[^>]*><span class="code-line-no">2<\/span>/);
    assert.match(out, /aria-label="Copy line 3"/);
    assert.match(out, /data-copy="block"/);
  });

  test("the copy buttons are marked so they are not copied themselves", async () => {
    const out = await html("```text\na\nb\n```");
    for (const button of out.match(/<button[^>]*>/g) ?? []) {
      assert.match(button, /data-nocopy="true"/);
    }
  });

  test("a title goes in the head, with the language beside it", async () => {
    for (const info of ['title="Step 1: install"', "title='Step 1: install'"]) {
      const out = await html(`\`\`\`bash ${info}\nx\n\`\`\``);
      assert.match(out, /<span class="lab-code-title">Step 1: install<\/span><span class="lab-code-lang">Shell<\/span>/, info);
    }
    assert.match(await html("```bash title=install.sh\nx\n```"), /lab-code-title">install\.sh</);
  });

  test("an unknown or missing language is plain text", async () => {
    for (const md of ["```nosuchlang\nx\n```", "```\nx\n```"]) {
      const out = await html(md);
      assert.match(out, /data-lang="text"/, md);
      assert.match(out, /lab-code-title">Text</, md);
    }
  });

  test("the language is case-insensitive", async () => {
    assert.match(await html("```Bash\nx\n```"), /data-lang="bash"[\s\S]*lab-code-title">Shell</);
  });

  test("an alias gets the same label as its language", async () => {
    assert.match(await html("```sh\nx\n```"), /lab-code-title">Shell</);
    assert.match(await html("```yml\nx\n```"), /lab-code-title">YAML</);
  });

  test("the code itself is escaped", async () => {
    const out = await html("```html\n<script>alert(1)</script>\n```");
    assertInert(out.replace(/ style="[^"]*"/g, ""), "html code");
    assert.match(out, /&#x3C;/);
  });
});

describe("lists", () => {
  test("a fence indented less than the item's text still belongs to the item", async () => {
    const out = plain(await html("1. Step\n  ```bash\n  echo 1\n  ```\n2. Next"));
    assert.match(out, /^<ol>\n<li>Step\n<figure class="lab-code" data-lang="bash">[\s\S]*<\/figure>\n<\/li>\n<li>Next<\/li>\n<\/ol>$/);
  });

  test("a fence keeps its own relative indentation", async () => {
    const out = await html("1. Step\n  ```yaml\n  a:\n    b: 1\n  ```");
    assert.match(out, /<span[^>]*>  b<\/span>/);
  });

  test("a two-space sub-list under a numbered item nests", async () => {
    assert.equal(
      await html("1. One\n  - sub\n2. Two"),
      "<ol>\n<li>One\n<ul>\n<li>sub</li>\n</ul>\n</li>\n<li>Two</li>\n</ol>",
    );
  });

  test("text back at the margin leaves the list", async () => {
    assert.equal(await html("- a\n\nAfter"), "<ul>\n<li>a</li>\n</ul>\n<p>After</p>");
  });
});

describe("source lines", () => {
  test("mark block elements with the line they start on, when asked", async () => {
    const out = await html("para *em*\n\n- item\n\n| a |\n|---|\n| 1 |", { sourceLines: true });
    assert.match(out, /<p data-line="1">para <em>em<\/em><\/p>/);
    assert.match(out, /<ul data-line="3">/);
    assert.match(out, /<table data-line="5">/);
  });

  test("are left off by default", async () => {
    assert.doesNotMatch(await html("para\n\n- item"), /data-line/);
  });
});

describe("missing library images", () => {
  test("are ringed with a note when named", async () => {
    const out = await html(`![alt](/api/lab-images/${IMG})`, { missingImages: [IMG] });
    assert.equal(
      out,
      `<p><span class="lab-image-missing" data-image-id="${IMG}">` +
        `<img src="/api/lab-images/${IMG}" alt="alt">` +
        `<span class="lab-image-missing-note">Not in the image library</span></span></p>`,
    );
  });

  test("a reader, who passes no list, gets the plain image", async () => {
    for (const missingImages of [undefined, []]) {
      assert.equal(
        await html(`![alt](/api/lab-images/${IMG})`, { missingImages }),
        `<p><img src="/api/lab-images/${IMG}" alt="alt"></p>`,
      );
    }
  });

  test("only the named ids, and only library images, are ringed", async () => {
    const out = await html(
      `![a](/api/lab-images/${IMG}) ![b](/api/lab-images/${IMG2}) ![c](https://e.example/${IMG}.png)`,
      { missingImages: [IMG] },
    );
    assert.equal((out.match(/lab-image-missing"/g) ?? []).length, 1);
    assert.match(out, new RegExp(`data-image-id="${IMG}"`));
  });
});

describe("labImageRefs", () => {
  test("is empty for a guide with no library images", () => {
    assert.deepEqual(labImageRefs(""), []);
    assert.deepEqual(labImageRefs("![x](https://e.example/a.png) ![y](/api/lab-images/not-a-uuid)"), []);
  });

  test("lists each image once, first mention first, with its first alt", () => {
    assert.deepEqual(
      labImageRefs(
        `![two](/api/lab-images/${IMG2})\n\n![one](/api/lab-images/${IMG})\n\n![again](/api/lab-images/${IMG2})`,
      ),
      [
        { id: IMG2, alt: "two" },
        { id: IMG, alt: "one" },
      ],
    );
  });

  test("an image with no alt has an empty one", () => {
    assert.deepEqual(labImageRefs(`![](/api/lab-images/${IMG})`), [{ id: IMG, alt: "" }]);
  });

  test("ignores a URL quoted in fenced or inline code", () => {
    assert.deepEqual(labImageRefs(`\`\`\`md\n![x](/api/lab-images/${IMG})\n\`\`\``), []);
    assert.deepEqual(labImageRefs(`\`![x](/api/lab-images/${IMG})\``), []);
  });

  test("ignores a path with a query or another segment after the id", () => {
    assert.deepEqual(
      labImageRefs(`![a](/api/lab-images/${IMG}?v=2) ![b](/api/lab-images/${IMG}/x) ![c](https://host/api/lab-images/${IMG})`),
      [],
    );
  });

  test("finds images inside callouts and list items", () => {
    assert.deepEqual(
      labImageRefs(`:::note Look\n![n](/api/lab-images/${IMG})\n:::\n\n1. Step\n  ![s](/api/lab-images/${IMG2})`),
      [
        { id: IMG, alt: "n" },
        { id: IMG2, alt: "s" },
      ],
    );
  });

  test("counts a reference-style image, which the renderer shows and rings", () => {
    assert.deepEqual(labImageRefs(`![alt][r]\n\n[r]: /api/lab-images/${IMG}`), [{ id: IMG, alt: "alt" }]);
  });
});
