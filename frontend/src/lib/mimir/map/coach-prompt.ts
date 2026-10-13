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
 */

import { createHash } from "node:crypto";
import type { MimirCoachStyle, MimirRepRole } from "@/db/schema";
import { conceptsInOrder, type MapConcept, type MapContent } from "./schema";

/** Where a video opens on the map. The coach links to it by concept id. */
export const playLink = (conceptId: string) => `/mimir/map?play=${encodeURIComponent(conceptId)}`;

/** The coach's progress state for one concept, as it needs to read it. Matches `ConceptState` without the server. */
export type SnapshotState = { videoFurthest: number; videoDuration: number; completed: boolean; mastered: boolean; recommended: boolean };

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
  return `${head}\n${c.explanation.trim()}\n${video}`;
}

const MARKERS = `MARKERS (these are read by the app, not shown to the rep; the reply is shown without them):
- When the rep has shown they know a concept's main points, end your reply with [MASTERED: concept-id] on its own line, using the id in square brackets above. This marks it mastered and removes any "Recommended" flag on the map.
- When the rep does not know a concept well enough, tell them in a sentence or two why the video will help, link it, and end your reply with [RECOMMEND: concept-id] on its own line. This flags the concept "Recommended" on the map.
- Never mention the markers. Use at most one [MASTERED] and one [RECOMMEND] per reply. Never put one in the middle of a reply.`;

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

CHECKING A CONCEPT. Work out the 3 to 5 main points of the concept from its explanation and its video. Ask the rep, in your own words, what they know about it. Ask for their understanding in their words, not a recitation. One question at a time.
- If they cover the main points, even without every detail, tell them so, include [MASTERED: concept-id], and move straight on: name the next concept (the lowest-numbered one not yet mastered) and ask what they know about it.
- If they get part of it, fill in the gap in a sentence or two and ask them to say it back before you mark anything.
- If they do not know it, or are guessing, do not lecture. Say what the concept is about in one sentence, recommend its video with a link written exactly like [Watch: Concept name](/mimir/map?play=concept-id), and include [RECOMMEND: concept-id]. Tell them to come back after watching. If the concept has no video, explain it briefly in plain words yourself and ask again.

AFTER A VIDEO. When a recommended concept shows as watched, welcome them back and ask similar questions to before, but not the same ones. They need to restate the main points in their own words before you include [MASTERED: concept-id].

THE BAR. Set it at the main points in the rep's own words. Do not mark a concept mastered on a guess, on a single word, or because they said "yes, I know that". If in doubt, ask one more question. If they ask to skip around, follow them, but still check each concept the same way.

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
      return s && (s.mastered || s.recommended || s.completed || s.videoFurthest > 0);
    })
    .map((c) => {
      const s = states[c.id]!;
      const flags = [s.mastered ? "mastered" : null, s.recommended ? "recommended (asked to watch the video)" : null, videoStatus(c, s)].filter(Boolean);
      return `- [${c.id}] ${c.name}: ${flags.join("; ")}`;
    });
  const text = [
    "PROGRESS SNAPSHOT",
    `Mastered: ${mastered} of ${concepts.length}.`,
    next ? `Next concept to cover: [${next.id}] ${next.name} (study #${next.study}; ${videoStatus(next, states[next.id])}).` : "Every concept is mastered.",
    lines.length ? `Concepts with any progress:\n${lines.join("\n")}` : "No concept has any progress yet.",
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
const ANYWHERE = /\[(?:MASTERED|RECOMMEND):\s*[A-Za-z0-9_-]+\s*\]/gi;

export type CoachReply = { text: string; mastered: string[]; recommended: string[] };

/**
 * A coach turn as shown, and what it asked the app to do. A marker only counts
 * on a line of its own and for a concept that is in the course; any other
 * trace of one is taken out of what is shown, so the rep never sees one.
 */
export function readCoachReply(raw: string, conceptIds: ReadonlySet<string>): CoachReply {
  const pick = (re: RegExp, skip: string[] = []) => {
    const found: string[] = [];
    for (const m of raw.matchAll(re)) {
      const id = m[1]!.toLowerCase();
      if (conceptIds.has(id) && !skip.includes(id) && !found.includes(id)) found.push(id);
    }
    return found.slice(0, 1);
  };
  const mastered = pick(MASTERED);
  const recommended = pick(RECOMMEND, mastered);
  const text = raw.replace(ANYWHERE, "").replace(/\n{3,}/g, "\n\n").trim();
  return { text, mastered, recommended };
}
