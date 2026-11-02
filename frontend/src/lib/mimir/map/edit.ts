/**
 * What an edit in the Map Editor changed, in lines a person can read, for the
 * save bar and the version's summary in the history. Pure, so the editor runs
 * it as you type and a test can hold it to its wording.
 */

import type { MapContent } from "./schema";

const quote = (s: string) => `“${s}”`;

/** One line per change from `before` to `after`, in the order the editor shows them; empty when nothing changed. */
export function describeChanges(before: MapContent, after: MapContent): string[] {
  const lines: string[] = [];
  if (before.title !== after.title) lines.push(`Renamed the map to ${quote(after.title)}.`);

  const sections = Math.max(before.sections.length, after.sections.length);
  for (let i = 0; i < sections; i++) {
    const a = before.sections[i];
    const b = after.sections[i];
    if (!a && b) lines.push(`Added the section ${quote(b.name)}.`);
    else if (a && !b) lines.push(`Removed the section ${quote(a.name)}.`);
    else if (a && b) {
      if (a.name !== b.name) lines.push(`Renamed the section ${quote(a.name)} to ${quote(b.name)}.`);
      if (a.from !== b.from || a.to !== b.to) lines.push(`Section ${quote(b.name)} now spans slides ${b.from}–${b.to}.`);
      if (a.band !== b.band) lines.push(`Moved the section ${quote(b.name)} to band ${b.band}.`);
    }
  }

  const beforeBuckets = new Map(before.buckets.map((g) => [`${g.id}|${g.sub ?? ""}`, g]));
  for (const g of after.buckets) {
    const was = beforeBuckets.get(`${g.id}|${g.sub ?? ""}`);
    if (!was) continue;
    if (was.name !== g.name) lines.push(`Renamed the group ${quote(was.name)} to ${quote(g.name)}.`);
    if (was.blurb !== g.blurb) lines.push(`Reworded the group ${quote(g.name)}'s description.`);
    if (was.level !== g.level) lines.push(`Moved the group ${quote(g.name)} to level ${g.level}.`);
  }

  const groupOf = (m: MapContent) => new Map(m.buckets.flatMap((g) => g.concepts.map((id) => [id, g.name] as const)));
  const beforeGroup = groupOf(before);
  const afterGroup = groupOf(after);
  const names = new Map(after.concepts.map((c) => [c.id, c.name]));
  const beforeConcepts = new Map(before.concepts.map((c) => [c.id, c]));
  for (const c of after.concepts) {
    const was = beforeConcepts.get(c.id);
    if (!was) continue;
    if (was.name !== c.name) lines.push(`Renamed the concept ${quote(was.name)} to ${quote(c.name)}.`);
    if (was.explanation !== c.explanation) lines.push(`Reworded the explanation of ${quote(c.name)}.`);
    if ((was.points ?? []).join("\n") !== (c.points ?? []).join("\n")) lines.push(`Changed the main points of ${quote(c.name)}.`);
    const from = new Set(was.requires ?? []);
    const to = new Set(c.requires ?? []);
    const added = [...to].filter((id) => !from.has(id)).map((id) => quote(names.get(id) ?? id));
    const removed = [...from].filter((id) => !to.has(id)).map((id) => quote(names.get(id) ?? id));
    if (added.length) lines.push(`${quote(c.name)} now depends on ${added.join(", ")}.`);
    if (removed.length) lines.push(`${quote(c.name)} no longer depends on ${removed.join(", ")}.`);
    if (beforeGroup.get(c.id) !== afterGroup.get(c.id)) lines.push(`Moved ${quote(c.name)} to the group ${quote(afterGroup.get(c.id) ?? "")}.`);
  }
  return lines;
}
