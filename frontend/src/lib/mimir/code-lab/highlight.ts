/**
 * Colours a page of HTML for the Code Lab's editor, CSS in a `<style>` block
 * included. It runs on every keystroke and only has to look right, not parse:
 * whatever it does not recognise comes back as text, and the tokens always
 * join back into exactly the source they came from.
 */

export type TokenKind = "text" | "punct" | "tag" | "attr" | "string" | "comment" | "selector" | "prop" | "value";
export type Token = { kind: TokenKind; text: string };

/** The match of a sticky pattern at `i`, or "". */
function at(re: RegExp, src: string, i: number): string {
  re.lastIndex = i;
  return re.exec(src)?.[0] ?? "";
}

const TAG_OPEN = /<\/?[!\w-]*/y;
const SPACE = /\s+/y;
const QUOTED = /"[^"]*"?|'[^']*'?/y;
const ATTR = /[^\s=>"'/]+/y;
const TEXT = /[^<]+/y;
const SELECTOR = /[^{}/]+/y;
const PROP = /[^{}:;/]+/y;
const VALUE = /[^{};/]+/y;

export function highlightHtml(src: string): Token[] {
  const out: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    if (!text) return;
    const last = out.at(-1);
    if (last?.kind === kind) last.text += text;
    else out.push({ kind, text });
  };

  let i = 0;
  while (i < src.length) {
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      const stop = end < 0 ? src.length : end + 3;
      push("comment", src.slice(i, stop));
      i = stop;
      continue;
    }
    const open = src[i] === "<" ? at(TAG_OPEN, src, i) : "";
    if (open.length > 1) {
      const closing = open.startsWith("</");
      const name = open.slice(closing ? 2 : 1);
      push("punct", closing ? "</" : "<");
      push("tag", name);
      i += open.length;
      while (i < src.length && src[i] !== ">") {
        const space = at(SPACE, src, i);
        const quoted = space ? "" : at(QUOTED, src, i);
        const attr = space || quoted ? "" : at(ATTR, src, i);
        if (space) push("text", space);
        else if (quoted) push("string", quoted);
        else if (attr) push("attr", attr);
        else push("punct", src[i]!);
        i += (space || quoted || attr || src[i]!).length;
      }
      if (src[i] === ">") {
        push("punct", ">");
        i++;
      }
      if (!closing && name.toLowerCase() === "style") {
        const end = src.toLowerCase().indexOf("</style", i);
        const stop = end < 0 ? src.length : end;
        highlightCss(src.slice(i, stop), push);
        i = stop;
      }
      continue;
    }
    const text = at(TEXT, src, i) || src[i]!;
    push("text", text);
    i += text.length;
  }
  return out;
}

function highlightCss(src: string, push: (kind: TokenKind, text: string) => void) {
  let i = 0;
  let inBlock = false;
  let inValue = false;
  while (i < src.length) {
    if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      push("comment", src.slice(i, stop));
      i = stop;
      continue;
    }
    const c = src[i]!;
    if (c === "{" || c === "}") {
      inBlock = c === "{";
      inValue = false;
      push("punct", c);
      i++;
      continue;
    }
    if (inBlock && !inValue && c === ":") {
      inValue = true;
      push("punct", c);
      i++;
      continue;
    }
    if (inBlock && c === ";") {
      inValue = false;
      push("punct", c);
      i++;
      continue;
    }
    const run = at(!inBlock ? SELECTOR : inValue ? VALUE : PROP, src, i) || c;
    // Leading and trailing space is plain text, so a property's colour starts at its name.
    const lead = run.length - run.trimStart().length;
    const body = run.trim();
    push("text", run.slice(0, lead));
    push(!inBlock ? "selector" : inValue ? "value" : "prop", body);
    push("text", run.slice(lead + body.length));
    i += run.length;
  }
}
