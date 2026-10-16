/**
 * What the map coach is told and how its replies are read: the course as one
 * system prompt, the progress snapshot it is handed whenever that changes, and
 * the markers it ends a reply with. Pure, so the unit suite can read every
 * prompt and exercise every rule without a database or a model.
 *
 * The coach works the way Mimir's coach always has: plain English, check
 * understanding in the rep's own words, four to six sentences then a question,
 * and a marker on its own line when it has seen what it was looking for. The
 * difference is the job: it walks one rep through the course in order, asking
 * what they know of each concept and sending them to its video when they do
 * not.
 *
 * Each concept is checked against a short checklist of its main points, and
 * the coach ticks each point as the rep says it, in whatever message it comes.
 * The ticks are kept by the app and shown back to the coach, so a rep who has
 * covered half a concept is asked only for the other half, never for all of
 * it again. Ticking the last point is what masters the concept.
 */

import { createHash } from "node:crypto";
import type { MimirCoachStyle, MimirRepRole } from "@/db/schema";
import { POINTS_MAX, POINTS_MIN, POINT_CHARS, checklistOf, conceptsInOrder, type ConceptPoint, type MapConcept, type MapContent } from "./schema";

/** Where a video opens on the map. The coach links to it by concept id. */
export const playLink = (conceptId: string) => `/mimir/map?play=${encodeURIComponent(conceptId)}`;

/** The coach's progress state for one concept, as it needs to read it. Matches `ConceptState` without the server. */
export type SnapshotState = {
  videoFurthest: number;
  videoDuration: number;
  completed: boolean;
  mastered: boolean;
  recommended: boolean;
  points?: ConceptPoint[] | null;
};

export type Rep = { name: string | null; role: MimirRepRole | null; coachStyle: MimirCoachStyle };
export type PromptSettings = { platformContext: string; namingGuard: string };

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function courseBlock(c: MapConcept, content: MapContent): string {
  const group = content.buckets.find((b) => b.id === c.bucket);
  const head = `### [${c.id}] ${c.name}\nStudy #${c.study} · Level ${c.level * 100} · ${group?.name ?? c.bucket}`;
  const video = c.video
    ? `Video (${clock(c.video.seconds)}), in the narrator's words:\n"""\n${c.video.transcript.trim()}\n"""`
    : "No video for this concept yet.";
  const points = c.points?.length ? `\nMain points (its checklist):\n${c.points.map((p, i) => `${i + 1}. ${p}`).join("\n")}` : "";
  return `${head}\n${c.explanation.trim()}${points}\n${video}`;
}

const MARKERS = `MARKERS (these are read by the app, not shown to the rep; the reply is shown without them):
- [POINTS: concept-id | first point | second point | ...] sets a concept's checklist, from ${POINTS_MIN} to ${POINTS_MAX} points separated by |. Write it once, in the reply where you first ask about a concept that has none. A concept that lists "Main points" above already has one.
- [COVERED: concept-id 1 3] ticks the points the rep has now put across, by their numbers in the checklist. Tick a point as soon as they have said it; ticks are kept, so list only the new ones. When every point is ticked the app marks the concept mastered and removes any "Recommended" flag on the map.
- [MASTERED: concept-id] marks a concept mastered outright. You rarely need it: ticking the last point does the same.
- [RECOMMEND: concept-id] flags the concept "Recommended" on the map, when you send the rep to its video.
- Use the ids in square brackets above. Put each marker on its own line at the very end of the reply, never in the middle. Use at most one of each per reply. Never mention the markers or read out point numbers: the rep sees their checklist ticked on screen as you go.`;

/** Words only a prompt that knows about checklists has: a conversation started before them is replaced rather than carried on. */
const CHECKLIST_RULES = "[COVERED: concept-id 1 3]";
export const knowsChecklists = (systemPrompt: string) => systemPrompt.includes(CHECKLIST_RULES);

/** The whole system prompt for a coach conversation, fixed when it starts. */
export function buildCoachSystem(content: MapContent, rep: Rep, settings: PromptSettings): string {
  const concepts = conceptsInOrder(content);
  const course = concepts.map((c) => courseBlock(c, content)).join("\n\n");
  const who = rep.name ? `\n\nRep context: ${rep.name}${rep.role ? ` (${rep.role})` : ""}. Tailor your coaching to their role and experience.` : "";
  const style =
    rep.coachStyle === "direct"
      ? "\n\nCOACHING STYLE: Be concise and direct. Skip lengthy Socratic sequences: give your feedback in 2 to 3 sentences, then ask at most one focused question."
      : "";
  const guard = settings.namingGuard.trim() ? `\n\n${settings.namingGuard.trim()}` : "";
  const platform = settings.platformContext.trim() ? `\n\n${settings.platformContext.trim()}` : "";

  return `You are a Harness platform educator coaching a sales rep through a course of technical concepts, one at a time, in the order below. Your goal is genuine understanding in plain English: help them know what each concept is and why it matters, not how to sell it. Teach each concept using only ideas from its own level or earlier ones.

THE COURSE (in study order; the rep also has a short video for each concept that has one):

${course}

HOW A SESSION WORKS

OPENING. You are handed a PROGRESS SNAPSHOT whenever the rep's progress changes. When the rep has just opened Mimir: greet them by name in one short line, say how many concepts they have mastered, and name the next one, which is the lowest-numbered concept not yet mastered. If they have watched a video since you last spoke, say so. Then ask them what they know about that concept. If every concept is mastered, congratulate them and offer to quiz them on any of them.

THE CHECKLIST. Each concept is checked against a short checklist of its main points: the things a rep needs to be able to explain to a colleague. Some concepts list theirs above, under "Main points". For any other, write one the first time you ask about it: ${POINTS_MIN} to ${POINTS_MAX} points drawn from its explanation and video, each a short plain-English phrase. Once a concept has a checklist, the progress snapshot shows it numbered, with what the rep has covered. It does not change, so never write a second one.

CHECKING A CONCEPT. Ask the rep, in your own words, what they know about it. Ask for their understanding in their words, not a recitation. One question at a time.
- Tick every point they have put across with [COVERED], whichever message it came in: in passing, out of order, spread over several answers, or while they were answering something else.
- A ticked point stays ticked. Never ask for it again, and never ask them to restate the whole concept or "put it all together".
- Then say briefly what they have got, and ask about one point that is still open, with a question that leads to it (for example "and why does that matter when a release goes wrong?"), not "tell me everything again".
- If they get a point half right, tick it when the core idea is there and add the missing piece yourself in a sentence. Leave it open only when the idea itself is missing or wrong; then fill it in briefly and ask a short question about just that point.
- When the last point is ticked the concept is mastered. Tell them so, and move straight on: name the next concept (the lowest-numbered one not yet mastered) and ask what they know about it.
- If they do not know the concept, or are guessing, do not lecture. Say what it is about in one sentence, recommend its video with a link written exactly like [Watch: Concept name](/mimir/map?play=concept-id), and include [RECOMMEND: concept-id]. Tell them to come back after watching; anything they already covered stays ticked. If the concept has no video, explain it briefly in plain words yourself and ask again.

AFTER A VIDEO. When a recommended concept shows as watched, welcome them back and ask about the points still open, in a different way from before. Do not ask again about the ones already ticked.

THE BAR. Be generous about how they say it and honest about what they say. The gist in their own words counts: casual language, an analogy of their own, a near-miss on the term for the right idea, or a customer-facing way of putting a technical point. Do not hold out for exact terminology, every detail, the video's wording, or the checklist's order. Do not tick a point on a guess, a lone buzzword, or "yes, I know that". If you are unsure about one point, ask one short question about that point, not about the whole concept. If they ask to skip around, follow them, and check each concept the same way.

${MARKERS}

COACHING STYLE
- Plain English first. Use the analogies from the videos where they help.
- Be honest before encouraging: name a real gap before praising what was right. Do not pad with validation.
- Keep replies to 4 to 6 sentences, then a question. Do not lecture.
- Tone: patient, direct, peer-level, a little warm. This is a learning conversation, not a test.
- If asked something outside the course, answer briefly if you can and steer back to the next concept.${who}${style}${platform}${guard}`;
}

/** Where a concept's video stands, in words. */
export function videoStatus(c: MapConcept, s: SnapshotState | undefined): string {
  if (!c.video) return "no video";
  if (!s || (!s.completed && s.videoFurthest <= 0)) return "video not started";
  if (s.completed) return "video watched to the end";
  const total = s.videoDuration > 0 ? s.videoDuration : c.video.seconds;
  return `video ${Math.round((Math.min(s.videoFurthest, total) / total) * 100)}% watched`;
}

/** The first concept, in study order, this rep has not mastered; null once they have mastered them all. */
export function nextConcept(concepts: MapConcept[], states: Record<string, SnapshotState | undefined>): MapConcept | null {
  return concepts.find((c) => !states[c.id]?.mastered) ?? null;
}

/**
 * The rep's progress as the coach reads it. Short on purpose: every mastered
 * or recommended concept, the one in progress, and the next to cover; the
 * rest are untouched.
 */
export function progressSnapshot(content: MapContent, states: Record<string, SnapshotState | undefined>): { text: string; hash: string } {
  const concepts = conceptsInOrder(content);
  const mastered = concepts.filter((c) => states[c.id]?.mastered).length;
  const next = nextConcept(concepts, states);
  const lines = concepts
    .filter((c) => {
      const s = states[c.id];
      return s && (s.mastered || s.recommended || s.completed || s.videoFurthest > 0 || s.points?.some((p) => p.covered));
    })
    .map((c) => {
      const s = states[c.id]!;
      const list = s.mastered ? null : checklistOf(c, s.points);
      const covered = list ? `${list.filter((p) => p.covered).length} of ${list.length} points covered` : null;
      const flags = [s.mastered ? "mastered" : null, s.recommended ? "recommended (asked to watch the video)" : null, covered, videoStatus(c, s)].filter(Boolean);
      return `- [${c.id}] ${c.name}: ${flags.join("; ")}`;
    });
  // The checklists still being worked through: the next concept's, and any other they have started on.
  const open = concepts
    .filter((c) => !states[c.id]?.mastered && (c.id === next?.id || states[c.id]?.points?.some((p) => p.covered)))
    .map((c) => {
      const list = checklistOf(c, states[c.id]?.points);
      if (!list) return `Checklist for [${c.id}] ${c.name}: none yet. Write one with [POINTS] when you ask about it.`;
      const lines = list.map((p, i) => `  ${i + 1}. ${p.covered ? "[covered]" : "[open]"} ${p.text}`);
      return `Checklist for [${c.id}] ${c.name} (${list.filter((p) => p.covered).length} of ${list.length} covered; ask only about open points):\n${lines.join("\n")}`;
    });
  const text = [
    "PROGRESS SNAPSHOT",
    `Mastered: ${mastered} of ${concepts.length}.`,
    next ? `Next concept to cover: [${next.id}] ${next.name} (study #${next.study}; ${videoStatus(next, states[next.id])}).` : "Every concept is mastered.",
    lines.length ? `Concepts with any progress:\n${lines.join("\n")}` : "No concept has any progress yet.",
    ...open,
  ].join("\n");
  return { text, hash: createHash("sha256").update(text).digest("hex").slice(0, 16) };
}

/** The rep's side of an opening, never shown. */
export const OPEN_REQUEST = "I just opened Mimir.";

/** A rep's turn as it is sent: the snapshot first when it has changed since the coach last saw it. */
export function turnContent(message: string, snapshot: { text: string } | null): string {
  return snapshot ? `<progress>\n${snapshot.text}\n</progress>\n\n${message}` : message;
}

const MASTERED = /^[ \t]*\[MASTERED:\s*([A-Za-z0-9_-]+)\s*\][ \t]*$/gim;
const RECOMMEND = /^[ \t]*\[RECOMMEND:\s*([A-Za-z0-9_-]+)\s*\][ \t]*$/gim;
const POINTS = /^[ \t]*\[POINTS:\s*([A-Za-z0-9_-]+)\s*\|([^\]\n]*)\][ \t]*$/gim;
const COVERED = /^[ \t]*\[COVERED:\s*([A-Za-z0-9_-]+)\s+([\d\s,]*\d)\s*\][ \t]*$/gim;
const ANYWHERE = /\[(?:MASTERED|RECOMMEND|POINTS|COVERED):[^\]\n]*\]/gi;

export type CoachReply = {
  text: string;
  mastered: string[];
  recommended: string[];
  /** A checklist the coach has set out, as its points in order. */
  checklists: { id: string; points: string[] }[];
  /** Points the rep has now covered, by number from 1. */
  covered: { id: string; points: number[] }[];
};

/**
 * A coach turn as shown, and what it asked the app to do. A marker only counts
 * on a line of its own and for a concept that is in the course; any other
 * trace of one is taken out of what is shown, so the rep never sees one.
 */
export function readCoachReply(raw: string, conceptIds: ReadonlySet<string>): CoachReply {
  const known = (m: RegExpMatchArray) => {
    const id = m[1]!.toLowerCase();
    return conceptIds.has(id) ? id : null;
  };
  const pick = (re: RegExp, skip: string[] = []) => {
    const found: string[] = [];
    for (const m of raw.matchAll(re)) {
      const id = known(m);
      if (id && !skip.includes(id) && !found.includes(id)) found.push(id);
    }
    return found.slice(0, 1);
  };
  const mastered = pick(MASTERED);
  const recommended = pick(RECOMMEND, mastered);

  const checklists: CoachReply["checklists"] = [];
  for (const m of raw.matchAll(POINTS)) {
    const id = known(m);
    const points = m[2]!
      .split("|")
      .map((p) => p.trim().slice(0, POINT_CHARS).trim())
      .filter(Boolean)
      .slice(0, POINTS_MAX);
    if (id && points.length >= POINTS_MIN) {
      checklists.push({ id, points });
      break;
    }
  }
  const covered: CoachReply["covered"] = [];
  for (const m of raw.matchAll(COVERED)) {
    const id = known(m);
    const points = [...new Set(m[2]!.match(/\d+/g)!.map(Number))].filter((n) => n >= 1 && n <= POINTS_MAX).sort((a, b) => a - b);
    if (id && points.length) {
      covered.push({ id, points });
      break;
    }
  }

  const text = raw.replace(ANYWHERE, "").replace(/\n{3,}/g, "\n\n").trim();
  return { text, mastered, recommended, checklists, covered };
}
