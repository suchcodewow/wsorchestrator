/**
 * Renders a guide's Markdown to HTML, with highlighting and a table of
 * contents.
 */

import "server-only";

import GithubSlugger from "github-slugger";
import type { Element, ElementContent, Root, RootContent } from "hast";
import { toString } from "hast-util-to-string";
import type {
  BlockContent,
  DefinitionContent,
  Paragraph,
  Root as MdastRoot,
} from "mdast";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { createHighlighter, type Highlighter } from "shiki";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";

export type TocEntry = { id: string; text: string; depth: 2 | 3 };

export type RenderedMarkdown = { html: string; toc: TocEntry[] };

const THEMES = { light: "github-light-default", dark: "github-dark-default" };

const LANGS = [
  "bash",
  "shellsession",
  "json",
  "jsonc",
  "yaml",
  "hcl",
  "terraform",
  "typescript",
  "javascript",
  "tsx",
  "python",
  "go",
  "java",
  "groovy",
  "sql",
  "dockerfile",
  "diff",
  "markdown",
  "html",
  "css",
  "xml",
  "toml",
  "ini",
  "powershell",
];

const LANG_LABELS: Record<string, string> = {
  bash: "Shell",
  shellsession: "Shell session",
  hcl: "Terraform",
  terraform: "Terraform",
  tsx: "TSX",
  jsonc: "JSON",
  yaml: "YAML",
  json: "JSON",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
  xml: "XML",
  toml: "TOML",
  ini: "INI",
  text: "Text",
};

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: Object.values(THEMES),
    langs: LANGS,
  });
  return highlighterPromise;
}

const isElement = (node: RootContent, tagName: string): node is Element =>
  node.type === "element" && node.tagName === tagName;

function rehypeCarryCodeTitle() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "code") return;

      const meta = (node.data as { meta?: string } | undefined)?.meta;
      if (!meta) return;

      const title = meta.match(/(?:^|\s)title=(?:"([^"]*)"|'([^']*)'|(\S+))/);
      const value = title?.[1] ?? title?.[2] ?? title?.[3];
      if (!value) return;

      const classes = Array.isArray(node.properties.className)
        ? node.properties.className
        : [];
      const lang = classes.find(
        (c) => typeof c === "string" && c.startsWith("language-"),
      );
      if (typeof lang !== "string") return;

      node.properties.className = classes.map((c) =>
        c === lang ? `${lang}:${encodeURIComponent(value)}` : c,
      );
    });
  };
}

function parseInfo(code: Element): { lang: string; title: string | null } {
  const classes = Array.isArray(code.properties.className)
    ? code.properties.className
    : [];
  const marker = classes.find(
    (c): c is string => typeof c === "string" && c.startsWith("language-"),
  );
  if (!marker) return { lang: "text", title: null };

  const [lang, encoded] = marker.slice("language-".length).split(":", 2);
  let title: string | null = null;
  if (encoded) {
    try {
      title = decodeURIComponent(encoded);
    } catch {
      title = encoded;
    }
  }
  return { lang: lang.toLowerCase() || "text", title };
}

const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(?=\S)/;

const FENCE = /^(`{3,}|~{3,})(.*)$/;

const CONTINUATION = 2;

function indentWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

const shiftLine = (line: string, by: number): string =>
  by > 0 && line.trim().length > 0 ? " ".repeat(by) + line : line;

function normaliseListIndents(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];

  const open: { srcIndent: number; contentColumn: number }[] = [];
  let fence: { marker: string; by: number; floor: number } | null = null;

  for (const line of lines) {
    if (fence) {
      out.push(
        shiftLine(line, Math.max(fence.by, fence.floor - indentWidth(line))),
      );

      const close = line.trim().match(FENCE);
      if (
        close &&
        close[1][0] === fence.marker[0] &&
        close[1].length >= fence.marker.length &&
        close[2].trim().length === 0
      ) {
        fence = null;
      }
      continue;
    }

    if (line.trim().length === 0) {
      out.push(line);
      continue;
    }

    const width = indentWidth(line);

    while (
      open.length > 0 &&
      width < open[open.length - 1].srcIndent + CONTINUATION
    ) {
      open.pop();
    }

    const item = open[open.length - 1];
    const by = item ? Math.max(0, item.contentColumn - width) : 0;
    out.push(shiftLine(line, by));

    const opened = line.match(LIST_ITEM);
    if (opened) {
      const marker = opened[2].length + opened[3].length;
      open.push({ srcIndent: width, contentColumn: width + by + marker });
    }

    const rest = opened ? line.slice(opened[0].length) : line.trimStart();
    const start = rest.match(FENCE);
    if (start) {
      const inner = opened ? open[open.length - 1] : item;
      fence = { marker: start[1], by, floor: inner?.contentColumn ?? 0 };
    }
  }

  return out.join("\n");
}

const CALLOUTS = {
  note: "Note",
  tip: "Tip",
  success: "Success",
  warning: "Warning",
  danger: "Caution",
} as const;

type CalloutKind = keyof typeof CALLOUTS;

const CALLOUT_ALIASES: Record<string, CalloutKind> = {
  info: "note",
  important: "note",
  caution: "danger",
  error: "danger",
  warn: "warning",
  check: "success",
};

const calloutKind = (name: string): CalloutKind | null =>
  name in CALLOUTS
    ? (name as CalloutKind)
    : (CALLOUT_ALIASES[name] ?? null);

const hasTitle = (name: string): boolean =>
  name === "details" || calloutKind(name) !== null;

const DIRECTIVE_OPEN = /^([ \t]*):{3,}([A-Za-z][A-Za-z\d-]*)[ \t]+(\S.*?)[ \t]*$/;

function normaliseDirectiveTitles(markdown: string): string {
  let fence: string | null = null;

  return markdown
    .split("\n")
    .map((line) => {
      const marker = line.trim().match(FENCE);
      if (fence) {
        if (
          marker &&
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length &&
          marker[2].trim().length === 0
        ) {
          fence = null;
        }
        return line;
      }
      if (marker) {
        fence = marker[1];
        return line;
      }

      const open = line.match(DIRECTIVE_OPEN);
      if (!open || !hasTitle(open[2].toLowerCase())) return line;

      const rest = open[3];
      if (rest.startsWith("[") || rest.startsWith("{")) return line;

      const label = rest.replace(/[[\]\\]/g, "\\$&");
      return `${open[1]}:::${open[2]}[${label}]`;
    })
    .join("\n");
}

const DEFAULT_SUMMARY = "Details";

type DirectiveContent = BlockContent | DefinitionContent;

function directiveTitle(
  children: DirectiveContent[],
  fallback: string,
): { title: Paragraph; body: DirectiveContent[] } {
  const [first] = children;
  const labelled =
    first?.type === "paragraph" &&
    (first.data as { directiveLabel?: boolean } | undefined)
      ?.directiveLabel === true;

  return labelled
    ? { title: first, body: children.slice(1) }
    : {
        title: {
          type: "paragraph",
          children: [{ type: "text", value: fallback }],
        },
        body: children,
      };
}

function remarkBlockDirectives() {
  return (tree: MdastRoot, file: { value: unknown }) => {
    const source = String(file.value);

    visit(tree, (node, index, parent) => {
      if (
        node.type !== "containerDirective" &&
        node.type !== "leafDirective" &&
        node.type !== "textDirective"
      ) {
        return;
      }

      const kind =
        node.type === "containerDirective" ? calloutKind(node.name) : null;

      if (
        node.type !== "containerDirective" ||
        (node.name !== "details" && kind === null)
      ) {
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (!parent || index === undefined || start === undefined || end === undefined) {
          return SKIP;
        }

        parent.children[index] = {
          type: "text",
          value: source.slice(start, end),
          position: node.position,
        };
        return SKIP;
      }

      if (kind !== null) {
        const { title, body } = directiveTitle(node.children, CALLOUTS[kind]);

        node.children = [title, ...body];
        node.data = {
          ...node.data,
          hName: "div",
          hProperties: { "data-callout": kind },
        };
        return;
      }

      const { title: summary, body } = directiveTitle(
        node.children,
        DEFAULT_SUMMARY,
      );
      summary.data = { ...summary.data, hName: "summary" };

      node.children = [summary, ...body];
      node.data = {
        ...node.data,
        hName: "details",
        hProperties: { open: node.attributes?.open !== undefined },
      };
    });
  };
}

const el = (
  tagName: string,
  properties: Element["properties"],
  children: ElementContent[] = [],
): Element => ({ type: "element", tagName, properties, children });

function icon(kind: "clipboard" | "check"): Element {
  const paths =
    kind === "clipboard"
      ? [
          "M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z",
          "M8 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2",
        ]
      : ["M5 13l4 4L19 7"];

  return el(
    "svg",
    {
      "aria-hidden": "true",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      className: [`code-icon`, `code-icon-${kind}`],
    },
    paths.map((d) => el("path", { d })),
  );
}

function blockCopyButton(): Element {
  return el(
    "button",
    {
      type: "button",
      className: ["code-copy"],
      "data-copy": "block",
      "data-nocopy": "true",
      "aria-label": "Copy code",
    },
    [
      icon("clipboard"),
      icon("check"),
      el("span", { className: ["code-copy-label"] }, [
        { type: "text", value: "Copy" },
      ]),
      el("span", { className: ["code-copy-done"] }, [
        { type: "text", value: "Copied" },
      ]),
    ],
  );
}

function lineCopyButton(lineNumber: number): Element {
  return el(
    "button",
    {
      type: "button",
      className: ["code-line-copy"],
      "data-copy": "line",
      "data-nocopy": "true",
      tabIndex: -1,
      "aria-label": `Copy line ${lineNumber}`,
      title: `Copy line ${lineNumber}`,
    },
    [
      el("span", { className: ["code-line-no"] }, [
        { type: "text", value: String(lineNumber) },
      ]),
      icon("clipboard"),
      icon("check"),
    ],
  );
}

function rehypeHighlight(highlighter: Highlighter) {
  const loaded = new Set(highlighter.getLoadedLanguages());

  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "pre" || !parent || index === undefined) return;

      const code = node.children.find((c) => isElement(c, "code"));
      if (!code || code.type !== "element") return;

      const { lang, title } = parseInfo(code);
      const language = loaded.has(lang) ? lang : "text";
      const source = toString(code).replace(/\n$/, "");

      const highlighted = highlighter.codeToHast(source, {
        lang: language,
        themes: THEMES,
        defaultColor: false,
      });

      const pre = highlighted.children.find(
        (c): c is Element => c.type === "element" && c.tagName === "pre",
      );
      if (!pre) return;

      const codeEl = pre.children.find(
        (c): c is Element => c.type === "element" && c.tagName === "code",
      );

      if (codeEl) {
        codeEl.children = codeEl.children.filter(
          (c) => !(c.type === "text" && c.value.trim().length === 0),
        );
      }

      const lines =
        codeEl?.children.filter(
          (c): c is Element =>
            c.type === "element" &&
            typeof c.properties?.class === "string" &&
            c.properties.class.split(" ").includes("line"),
        ) ?? [];

      if (lines.length > 1) {
        lines.forEach((line, i) => {
          const blank = toString(line).trim().length === 0;
          line.children.unshift(
            blank
              ? el(
                  "span",
                  {
                    className: ["code-line-copy", "is-blank"],
                    "data-nocopy": "true",
                    "aria-hidden": "true",
                  },
                  [
                    el("span", { className: ["code-line-no"] }, [
                      { type: "text", value: String(i + 1) },
                    ]),
                  ],
                )
              : lineCopyButton(i + 1),
          );
        });
        addClass(pre, "has-line-numbers");
      }

      const label = LANG_LABELS[language] ?? language;

      const figure = el(
        "figure",
        { className: ["lab-code"], "data-lang": language },
        [
          el("figcaption", { className: ["lab-code-head"] }, [
            el("span", { className: ["lab-code-title"] }, [
              { type: "text", value: title ?? label },
            ]),
            ...(title
              ? [
                  el("span", { className: ["lab-code-lang"] }, [
                    { type: "text", value: label },
                  ]),
                ]
              : []),
            blockCopyButton(),
          ]),
          pre,
        ],
      );

      figure.position = node.position;
      parent.children[index] = figure;

      return "skip";
    });
  };
}

function addClass(node: Element, name: string): void {
  const key = "className" in node.properties ? "className" : "class";
  const current = node.properties[key];

  const existing: string[] = (
    Array.isArray(current)
      ? current.map(String)
      : typeof current === "string"
        ? current.split(" ")
        : []
  ).filter(Boolean);

  if (existing.includes(name)) return;

  if (key === "className") node.properties.className = [...existing, name];
  else node.properties.class = [...existing, name].join(" ");
}

function chevron(): Element {
  return el(
    "svg",
    {
      "aria-hidden": "true",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      className: ["lab-details-chevron"],
    },
    [el("path", { d: "M9 6l6 6-6 6" })],
  );
}

function rehypeDetails() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "details") return;

      const summary = node.children.find((c): c is Element =>
        isElement(c, "summary"),
      );
      if (!summary) return;

      addClass(node, "lab-details");
      addClass(summary, "lab-details-summary");
      summary.children = [
        chevron(),
        el("span", { className: ["lab-details-title"] }, summary.children),
      ];

      const body = node.children.filter((c) => c !== summary);
      node.children = [
        summary,
        ...(body.length > 0
          ? [el("div", { className: ["lab-details-body"] }, body)]
          : []),
      ];
    });
  };
}

const CALLOUT_ICONS: Record<CalloutKind, () => ElementContent[]> = {
  note: () => [
    el("path", {
      d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
    }),
    el("path", { d: "m15 5 4 4" }),
  ],
  tip: () => [
    el("circle", { cx: "12", cy: "12", r: "10" }),
    el("path", { d: "M12 16v-4" }),
    el("path", { d: "M12 8h.01" }),
  ],
  success: () => [
    el("circle", { cx: "12", cy: "12", r: "10" }),
    el("path", { d: "m9 12 2 2 4-4" }),
  ],
  warning: () => [
    el("path", {
      d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
    }),
    el("path", { d: "M12 9v4" }),
    el("path", { d: "M12 17h.01" }),
  ],
  danger: () => [
    el("path", {
      d: "M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z",
    }),
    el("path", { d: "M12 8v4" }),
    el("path", { d: "M12 16h.01" }),
  ],
};

function calloutIcon(kind: CalloutKind): Element {
  return el(
    "svg",
    {
      "aria-hidden": "true",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      className: ["lab-callout-icon"],
    },
    CALLOUT_ICONS[kind](),
  );
}

function rehypeCallouts() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "div") return;

      const kind = node.properties["data-callout"];
      if (typeof kind !== "string" || !(kind in CALLOUTS)) return;

      const head = node.children.find((c): c is Element => isElement(c, "p"));
      if (!head) return;

      addClass(node, "lab-callout");
      addClass(head, "lab-callout-head");
      head.children = [
        calloutIcon(kind as CalloutKind),
        el("span", { className: ["lab-callout-title"] }, head.children),
      ];

      const body = node.children.filter((c) => c !== head);
      node.children = [
        head,
        ...(body.some((c) => c.type !== "text" || c.value.trim().length > 0)
          ? [el("div", { className: ["lab-callout-body"] }, body)]
          : []),
      ];
    });
  };
}

function rehypeHeadings() {
  return (tree: Root, file: { data: Record<string, unknown> }) => {
    const slugger = new GithubSlugger();
    const toc: TocEntry[] = [];

    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "h2" && node.tagName !== "h3") return;

      const text = toString(node);
      const id =
        typeof node.properties.id === "string" && node.properties.id.length > 0
          ? node.properties.id
          : slugger.slug(text || "section");

      node.properties.id = id;
      node.children = [
        el("a", { href: `#${id}`, className: ["heading-anchor"] }, node.children),
      ];

      toc.push({ id, text, depth: node.tagName === "h2" ? 2 : 3 });
    });

    file.data.toc = toc;
  };
}

function rehypeExternalLinks() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "a") return;
      const href = node.properties.href;
      if (typeof href !== "string" || !/^https?:\/\//i.test(href)) return;

      node.properties.target = "_blank";
      node.properties.rel = ["noopener", "noreferrer"];
    });
  };
}

const LINE_MARKED_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "figure",
  "details",
  "summary",
  "div",
  "table",
  "thead",
  "tbody",
  "tr",
  "hr",
  "dl",
  "dt",
  "dd",
]);

function rehypeSourceLines() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      const line = node.position?.start.line;
      if (line === undefined || !LINE_MARKED_TAGS.has(node.tagName)) return;
      node.properties["data-line"] = String(line);
    });
  };
}

const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["data-callout", ...Object.keys(CALLOUTS)] as [string, ...string[]],
    ],
  },
};

const buildProcessor = (highlighter: Highlighter, sourceLines: boolean) => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkBlockDirectives)
    .use(remarkRehype)
    .use(rehypeCarryCodeTitle)
    .use(rehypeSanitize, SANITIZE_SCHEMA)
    .use(rehypeHighlight, highlighter)
    .use(rehypeDetails)
    .use(rehypeCallouts)
    .use(rehypeHeadings)
    .use(rehypeExternalLinks);

  if (sourceLines) processor.use(rehypeSourceLines);

  return processor.use(rehypeStringify);
};

const processors = new Map<
  boolean,
  Promise<ReturnType<typeof buildProcessor>>
>();

function getProcessor(sourceLines: boolean) {
  let processor = processors.get(sourceLines);
  if (!processor) {
    processor = getHighlighter().then((h) => buildProcessor(h, sourceLines));
    processors.set(sourceLines, processor);
  }
  return processor;
}

export async function renderMarkdown(
  markdown: string,
  {
    sourceLines = false,
  }: { sourceLines?: boolean } = {},
): Promise<RenderedMarkdown> {
  if (markdown.trim().length === 0) return { html: "", toc: [] };

  const processor = await getProcessor(sourceLines);
  const file = await processor.process(
    normaliseListIndents(normaliseDirectiveTitles(markdown)),
  );

  return {
    html: String(file),
    toc: (file.data as { toc?: TocEntry[] }).toc ?? [],
  };
}
