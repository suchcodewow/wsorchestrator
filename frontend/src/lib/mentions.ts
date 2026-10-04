/**
 * "@" tags in a comment. The text spells each tagged person as "@Full Name";
 * who they are is sent beside it by email, so a name two people share, or one
 * typed by hand, never tags anyone by accident. Pure, for the box that writes
 * a comment and the list that shows it.
 */

export type MentionPick = { email: string; fullName: string };

/** What has been typed after an "@" before the caret, and where the "@" is; null when the caret is not in a tag. */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  // An "@" inside a word is an email address, not a tag.
  if (at > 0 && /\S/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  // A tag is a name of up to three words; a new line, or a fourth word, ends it.
  if (/[\n@]/.test(query) || query.split(" ").length > 3 || query.length > 40) return null;
  return { start: at, query };
}

/** `text` with the tag being typed from `start` to `caret` replaced by `@Full Name `, and where the caret goes. */
export function insertMention(text: string, start: number, caret: number, pick: MentionPick): { text: string; caret: number } {
  const tag = `@${pick.fullName} `;
  return { text: text.slice(0, start) + tag + text.slice(caret), caret: start + tag.length };
}

/** The people picked who are still named in `text`, each once: deleting a tag from the text untags them. */
export function mentionsIn(text: string, picks: MentionPick[]): MentionPick[] {
  const seen = new Set<string>();
  return picks.filter((p) => {
    if (seen.has(p.email) || !text.includes(`@${p.fullName}`)) return false;
    seen.add(p.email);
    return true;
  });
}

/** Whether `pick` matches what has been typed after the "@": any word of the name, or the email, starting with it. */
export function matchesMention(pick: MentionPick, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = pick.fullName.toLowerCase();
  return name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q)) || pick.email.startsWith(q);
}

export type MentionSegment = { text: string; mention?: MentionPick };

/** `text` cut into plain runs and the tags of the people it tags, for drawing the tags apart. */
export function mentionSegments(text: string, mentions: MentionPick[]): MentionSegment[] {
  // The longest name first, so "@Ann Lee" is not read as "@Ann".
  const tags = mentions
    .filter((m) => m.fullName)
    .map((m) => ({ tag: `@${m.fullName}`, mention: m }))
    .sort((a, b) => b.tag.length - a.tag.length);
  const out: MentionSegment[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const hit = text[i] === "@" ? tags.find((t) => text.startsWith(t.tag, i)) : undefined;
    if (hit) {
      if (plain) out.push({ text: plain });
      plain = "";
      out.push({ text: hit.tag, mention: hit.mention });
      i += hit.tag.length;
    } else {
      plain += text[i];
      i += 1;
    }
  }
  if (plain) out.push({ text: plain });
  return out;
}
