/** Mimir: the reference library and its coach, for everyone; its content and coaching settings, for Training Administrators. */

import {
  MIMIR_KINDS,
  MIMIR_MESSAGE_MAX,
  MIMIR_REFLECTION_MAX,
  MIMIR_SETTING_MAX,
} from "@/db/schema";
import { MIMIR_ITEM_LIST, MIMIR_PROGRESS_LIST, MIMIR_STUDIO_JOB_LIST } from "@/lib/list-specs";
import { DECK_MAX_BYTES, VIDEO_NOTES_MAX } from "@/lib/mimir/studio/shapes";
import { PAGE_FIELDS, listQuery } from "./paging";
import type { EndpointGroup, Field } from "./types";

const KIND_TYPE = MIMIR_KINDS.map((k) => `"${k}"`).join(" | ");
const ITEM_ID: Field = { name: "id", type: "string", required: true, note: "the item's id, such as agent-software-delivery, cd or jenkins" };
const SUMMARY_SHAPE = "{ id, kind, parentId, position, title, emoji, color, summary, attrs, updatedAt }";
const MESSAGE_SHAPE = `{ seq, role: "user" | "assistant", text, html: string | null, at }`;
const ITEM_FIELDS: Field[] = [
  {
    name: "id",
    type: "string",
    note: "Lowercase letters, digits, - and _. On a create, made from the title when left out. Ignored on a replace.",
  },
  { name: "kind", type: KIND_TYPE, required: true, note: "Cannot change once the item exists." },
  {
    name: "parentId",
    type: "string | null",
    note: "A question sits under a discovery group and a term under a category, always; a capability sits under the agent it belongs to, or under nothing for one of Harness's other products; nothing else has a parent.",
  },
  { name: "position", type: "integer", note: "Order within its kind, from 0. Default 0." },
  { name: "title", type: "string", required: true },
  { name: "emoji", type: "string" },
  { name: "color", type: "string", note: "#rrggbb, or empty." },
  { name: "summary", type: "string" },
  { name: "body", type: "string", note: "Markdown." },
  { name: "sections", type: "{ title, content }[]", note: "Folded Markdown blocks; at most 30." },
  {
    name: "attrs",
    type: "object",
    note: "The fields only some kinds use: badge, role, tag, buyer, scenario, salesAngle, strength, advantages, watchOut, headline, url, loop, group, why, followUp, seeAlso, forKind (strings), number, featured, and cats, mods and aliases (string lists; aliases are the forms of a glossary term that link to it). Any other key is refused.",
  },
];
const JOB_ID: Field = { name: "id", type: "string", required: true, note: "the job's id" };
const JOB_SHAPE = `{ id, kind: "deck" | "video", status: "uploading" | "queued" | "running" | "ready" | "succeeded" | "failed" | "published" | "discarded", conceptId: string | null, label, input, result: object | null, progress: string | null, error: string | null, requestedBy: string | null, createdAt, startedAt: string | null, finishedAt: string | null, updatedAt }`;
const DIFF_SHAPE = "{ added: { id, name, level }[], removed: { id, name, hadVideo }[], changed: { id, name, was: string | null, what: string[] }[], unchanged: number, slides: { was, now } }";
const ITEM_ERRORS = [
  { status: 400, error: "invalid", when: "the body does not parse" },
  { status: 400, error: "bad_parent", when: "parentId names no item, or one this kind may not sit under" },
];

export const MIMIR_GROUPS: EndpointGroup[] = [
  {
    id: "mimir",
    title: "Mimir library (archived)",
    intro:
      "The previous Mimir, kept at /mimir-archive for Training Administrators. The GTM reference library and its AI coach: Harness's four agents and the capabilities each is made of, personas, competitors, proof points and more. Anyone signed in reads the content, is coached on it, and keeps their own progress; nobody sees anyone else's. Training Administrators edit the content and the coaching settings.",
    endpoints: [
      {
        method: "GET",
        path: "/api/mimir/items",
        summary: "Lists Mimir items, a page at a time.",
        access: "signedIn",
        token: true,
        query: [
          { name: "kind", type: KIND_TYPE, note: "One kind only." },
          { name: "parent", type: "string", note: "Items under this item's id, or none for top-level items only." },
          { name: "cat", type: "string", note: "Competitors carrying this category id, such as cd." },
          { name: "featured", type: '"1"', note: "Top competitors only." },
          ...listQuery(MIMIR_ITEM_LIST.sorts, "the title, summary or body"),
        ],
        returns: `{ items: ${SUMMARY_SHAPE}[], ${PAGE_FIELDS} }`,
        errors: [{ status: 400, error: "invalid_kind", when: "kind is not one of the kinds" }],
      },
      {
        method: "GET",
        path: "/api/mimir/items/{id}",
        summary: "Returns one item in full, with what holds it and what it holds.",
        access: "signedIn",
        token: true,
        notes:
          "children are the items under it, at most 100, in order: an agent's capabilities, or a discovery group's questions. coach is the coaching mode for a kind the coach covers, and null for the rest.",
        params: [ITEM_ID],
        returns: `{ item: ${SUMMARY_SHAPE} & { body, sections, createdAt }, parent: summary | null, children: summary[], coach: "agent" | "capability" | "concept" | "sdlc" | "persona" | "competitive" | "usecase" | null }`,
        errors: [{ status: 404, error: "not_found", when: "no item has that id" }],
      },
      {
        method: "POST",
        path: "/api/mimir/items",
        summary: "Makes a Mimir item.",
        access: "trainingAdmin",
        token: true,
        body: { kind: "json", fields: ITEM_FIELDS },
        returns: "201 { id }",
        errors: [...ITEM_ERRORS, { status: 409, error: "taken", when: "an item already has that id" }],
      },
      {
        method: "PUT",
        path: "/api/mimir/items/{id}",
        summary: "Replaces a Mimir item's fields.",
        access: "trainingAdmin",
        token: true,
        notes:
          "Conversations already under way keep the prompt they started with; the change reaches the next conversation about it.",
        params: [ITEM_ID],
        body: { kind: "json", fields: ITEM_FIELDS },
        returns: "{ ok: true }",
        errors: [
          ...ITEM_ERRORS,
          { status: 404, error: "not_found", when: "no item has that id" },
          { status: 409, error: "kind_fixed", when: "kind differs from the item's" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/mimir/items/{id}",
        summary: "Removes a Mimir item, with everyone's progress on it and conversations about it.",
        access: "trainingAdmin",
        token: true,
        params: [ITEM_ID],
        returns: "{ ok: true }",
        errors: [
          { status: 404, error: "not_found", when: "no item has that id" },
          { status: 409, error: "has_children", when: "other items sit under it; remove them first" },
        ],
      },
      {
        method: "POST",
        path: "/api/mimir/import",
        summary: "Imports Mimir items from a JSON file, updating those whose id exists and making the rest.",
        access: "trainingAdmin",
        token: true,
        notes:
          "The file holds { items: [...] }, each shaped as for POST /api/mimir/items with its id, and every parent before what it holds. All of it is written or none. Items the file leaves out are left alone, and an updated item keeps everyone's progress on it. frontend/scripts/mimir-convert.ts makes such a file from the Learning Hub's data.ts.",
        body: { kind: "multipart", fields: [{ name: "file", type: "file", required: true, note: "JSON, at most 8 MB and 2000 items" }] },
        returns: "{ created: number, updated: number }",
        errors: [
          { status: 400, error: "no_file", when: "there is no file field" },
          { status: 400, error: "not_json", when: "the file is not JSON" },
          { status: 400, error: "invalid", when: "an item does not parse; path and message say where" },
          { status: 400, error: "bad_parent", when: "an item's parent is neither in the database nor earlier in the file, or is the wrong kind; index and id say which" },
          { status: 409, error: "kind_fixed", when: "an item would change the kind of one that exists" },
          { status: 409, error: "taken", when: "two items in the file share an id" },
          { status: 413, error: "too_large", when: "the file is over 8 MB" },
        ],
      },
      {
        method: "POST",
        path: "/api/mimir/items/{id}/visit",
        summary: "Notes that you opened an item, which makes it viewed in your progress.",
        access: "signedIn",
        token: true,
        params: [ITEM_ID],
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "no item has that id" }],
      },
      {
        method: "GET",
        path: "/api/mimir/items/{id}/chat",
        summary: "Returns your coaching conversation about an item, or the coach's opener before you have one.",
        access: "signedIn",
        token: true,
        notes:
          "messages holds the latest 100 turns; earlier is true when older ones come before them, which before= reads a page at a time. configured is false when the server has no Claude key: the conversation reads but the coach cannot reply. masteryReady in progress means the coach has said you are ready and is waiting on your takeaway.",
        params: [ITEM_ID],
        query: [{ name: "before", type: "integer", note: "The page of turns before this seq, for reading back further." }],
        returns: `{ mode, conversation: { id, startedAt, messages: ${MESSAGE_SHAPE}[], earlier: boolean } | null, opener: { text, html } | null, progress: { tier: "none" | "viewed" | "practiced" | "mastered", firstVisitAt, lastVisitAt, masteryReady, reflection }, configured: boolean }`,
        errors: [
          { status: 404, error: "not_found", when: "no item has that id" },
          { status: 409, error: "not_coachable", when: "the coach does not cover this kind of item" },
        ],
      },
      {
        method: "POST",
        path: "/api/mimir/items/{id}/chat",
        summary: "Sends the coach a message and returns it with the coach's reply.",
        access: "signedIn",
        token: true,
        notes:
          "The first message starts the conversation, fixing its prompt from the item, the coaching settings and your profile as they are then. The coach is Claude Sonnet 5.5; a request it declines is answered by Anthropic's fallback model, and when it can't be reached, by Claude Haiku 4.5. Send Accept: text/event-stream to have the reply streamed as it is written — text events with each delta, restart if it begins again on the fallback model, then done with the body below, or error with { error, status } — otherwise the whole reply comes back as JSON. A conversation runs as long as the model can read: about a million tokens.",
        params: [ITEM_ID],
        body: { kind: "json", fields: [{ name: "message", type: "string", required: true, note: `up to ${MIMIR_MESSAGE_MAX} characters` }] },
        returns: `{ messages: [yours, the coach's] as ${MESSAGE_SHAPE}, masteryReady: boolean, tier }`,
        errors: [
          { status: 400, error: "invalid", when: "message is missing, empty or too long" },
          { status: 404, error: "not_found", when: "no item has that id" },
          { status: 409, error: "not_coachable", when: "the coach does not cover this kind of item" },
          { status: 409, error: "busy", when: "the coach is still replying to your last message" },
          { status: 409, error: "full", when: "the conversation is as long as the model can read; start a new one" },
          { status: 422, error: "refused", when: "Claude declined to reply; your message was not kept" },
          { status: 502, error: "upstream", when: "Claude could not be reached or returned nothing; your message was not kept" },
          { status: 503, error: "not_configured", when: "the server has no Claude key" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/mimir/items/{id}/chat",
        summary: "Throws away your conversation about an item, so the next message starts afresh.",
        access: "signedIn",
        token: true,
        notes: "Your progress on it, the coach's mastery signal and your takeaway stay.",
        params: [ITEM_ID],
        returns: "{ ok: true, deleted: boolean }",
      },
      {
        method: "PUT",
        path: "/api/mimir/items/{id}/reflection",
        summary: "Saves your one-line takeaway on an item, which with the coach's signal makes it mastered.",
        access: "signedIn",
        token: true,
        params: [ITEM_ID],
        body: {
          kind: "json",
          fields: [{ name: "reflection", type: "string", required: true, note: `up to ${MIMIR_REFLECTION_MAX} characters` }],
        },
        returns: '{ ok: true, tier: "mastered" }',
        errors: [
          { status: 400, error: "invalid", when: "reflection is missing, empty or too long" },
          { status: 404, error: "not_found", when: "no item has that id" },
          { status: 409, error: "not_ready", when: "the coach has not yet said you are ready" },
        ],
      },
      {
        method: "GET",
        path: "/api/mimir/progress",
        summary: "Returns your progress overall and on each item it is kept on, a page at a time, and where to carry on from.",
        access: "signedIn",
        token: true,
        notes:
          "Progress is kept on every kind the coach covers, and on discovery groups. exchanges counts the messages you have sent in your current conversation about the item.",
        query: [
          { name: "kind", type: KIND_TYPE, note: "One kind only." },
          ...listQuery(MIMIR_PROGRESS_LIST.sorts, "the title", "desc"),
        ],
        returns: `{ summary: { total, viewed, practiced, mastered }, resume: { id, kind, title } | null, items: { id, kind, title, emoji, tier, exchanges, lastVisitAt, reflection }[], ${PAGE_FIELDS} }`,
        errors: [{ status: 400, error: "invalid_kind", when: "kind is not one of the kinds" }],
      },
      {
        method: "DELETE",
        path: "/api/mimir/progress",
        summary: "Starts Mimir over for you: every item back to not started, every conversation and takeaway deleted.",
        access: "signedIn",
        token: true,
        notes: "Irreversible. Your role and coaching style stay.",
        returns: "{ ok: true, items: number, conversations: number }",
      },
      {
        method: "GET",
        path: "/api/mimir/me",
        summary: "Returns what you have told Mimir's coach about yourself.",
        access: "signedIn",
        token: true,
        returns: '{ role: "SDR" | "AE" | "SE" | null, coachStyle: "socratic" | "direct" }',
      },
      {
        method: "PUT",
        path: "/api/mimir/me",
        summary: "Sets your role and how you like to be coached.",
        access: "signedIn",
        token: true,
        notes: "Kept apart from your Diagnostic track. Conversations already under way keep the prompt they started with.",
        body: {
          kind: "json",
          fields: [
            { name: "role", type: '"SDR" | "AE" | "SE" | null', required: true },
            { name: "coachStyle", type: '"socratic" | "direct"', required: true },
          ],
        },
        returns: "{ ok: true, role, coachStyle }",
        errors: [{ status: 400, error: "invalid", when: "the body does not parse" }],
      },
      {
        method: "GET",
        path: "/api/mimir/settings",
        summary: "Returns the coaching settings every prompt carries.",
        access: "trainingAdmin",
        token: true,
        notes: "Each is its default until someone saves it; updatedAt and updatedBy are null until then.",
        returns: "{ platformContext, namingGuard, updatedAt, updatedBy }",
      },
      {
        method: "PUT",
        path: "/api/mimir/settings",
        summary: "Saves the coaching settings.",
        access: "trainingAdmin",
        token: true,
        notes: "Conversations already under way keep the prompt they started with.",
        body: {
          kind: "json",
          fields: [
            { name: "platformContext", type: "string", required: true, note: `up to ${MIMIR_SETTING_MAX} characters; in the agent, capability, competitive and use-case prompts` },
            { name: "namingGuard", type: "string", required: true, note: `up to ${MIMIR_SETTING_MAX} characters; at the end of every prompt` },
          ],
        },
        returns: "{ ok: true }",
        errors: [{ status: 400, error: "invalid", when: "the body does not parse" }],
      },
    ],
  },
  {
    id: "mimir-studio",
    title: "Mimir Studio",
    intro:
      "Making the Mimir map and its videos with Claude. A new slide deck is read into a draft of the map, which is checked against the live one and then published or thrown away; a concept's video is written, narrated and rendered by the explainer standards, taking in the accepted comments on the video before it. Each runs as a job on the mimir-studio Cloud Run job, which reports its progress on the job's row; at most one deck is under way at a time, and one video per concept. A job that stops reporting for four hours is marked failed.",
    endpoints: [
      {
        method: "POST",
        path: "/api/mimir/studio/decks",
        summary: "Makes a job for a new slide deck and returns a link to upload the file to.",
        access: "mimirStudio",
        token: true,
        notes:
          "uploadUrl is a signed Cloud Storage link, good for an hour, to PUT the .pptx to directly; then POST start. The job waits in uploading until then, and counts as the deck under way.",
        body: {
          kind: "json",
          fields: [
            { name: "fileName", type: "string", required: true, note: "ends in .pptx, at most 200 characters" },
            { name: "bytes", type: "integer", required: true, note: `the file's size, at most ${DECK_MAX_BYTES / 1024 / 1024} MB` },
          ],
        },
        returns: `{ job: ${JOB_SHAPE}, uploadUrl: string }, with 201`,
        errors: [
          { status: 400, error: "invalid", when: "a field is missing or out of range" },
          { status: 400, error: "not_pptx", when: "fileName does not end in .pptx" },
          { status: 409, error: "busy", when: "another deck is under way" },
          { status: 503, error: "not_configured", when: "this deployment has no bucket or no studio job" },
        ],
      },
      {
        method: "POST",
        path: "/api/mimir/studio/decks/{id}/start",
        summary: "Sets an uploaded deck's job going.",
        access: "mimirStudio",
        token: true,
        notes:
          "The studio turns every slide into a picture, reads its text and notes, and has Claude write a new map of 100, 200 and 300-level concepts from them, keeping the live concepts' ids wherever they still fit. The job is then ready, with the draft in its result. started is false when the studio could not be started; the job is then failed, with why.",
        params: [JOB_ID],
        returns: `{ job: ${JOB_SHAPE}, started: boolean }`,
        errors: [
          { status: 404, error: "not_found", when: "no deck job has that id" },
          { status: 409, error: "not_uploading", when: "the job has already been started, or has ended" },
          { status: 409, error: "no_file", when: "the file is not in the bucket yet" },
          { status: 503, error: "not_configured", when: "this deployment has no bucket" },
        ],
      },
      {
        method: "GET",
        path: "/api/mimir/studio/decks/{id}/slides/{n}",
        summary: "Redirects to one slide's picture in a deck's draft.",
        access: "mimirStudio",
        token: true,
        notes: "The redirect goes to a signed Cloud Storage link, good for an hour. The pictures go once the draft is published or thrown away.",
        params: [JOB_ID, { name: "n", type: "number", required: true, note: "the slide's number, 1 to 200" }],
        returns: "a 302 to the JPEG",
        errors: [
          { status: 404, error: "not_found", when: "no deck job has that id, or n is not a slide number" },
          { status: 404, error: "missing", when: "the draft has no picture of that slide" },
          { status: 503, error: "not_configured", when: "this deployment has no bucket" },
        ],
      },
      {
        method: "POST",
        path: "/api/mimir/studio/decks/{id}/publish",
        summary: "Publishes a read deck: its slides and map replace the live ones.",
        access: "mimirStudio",
        token: true,
        notes:
          "The slide pictures are copied over the map's first, and a live picture the deck has no slide for is deleted. Each concept the draft keeps keeps its video as it is now and everyone's progress on it; a concept the draft drops goes, with its video, from the map. diff is what changed.",
        params: [JOB_ID],
        returns: `{ job: ${JOB_SHAPE}, diff: ${DIFF_SHAPE} }`,
        errors: [
          { status: 404, error: "not_found", when: "no deck job has that id" },
          { status: 409, error: "not_ready", when: "the job is not ready to publish" },
          { status: 409, error: "invalid", when: "the job's draft does not fit the map's shape" },
          { status: 503, error: "not_configured", when: "this deployment has no bucket" },
        ],
      },
      {
        method: "POST",
        path: "/api/mimir/studio/decks/{id}/discard",
        summary: "Throws away a deck's draft, or a deck that never finished uploading or failed, with its file.",
        access: "mimirStudio",
        token: true,
        params: [JOB_ID],
        returns: `{ job: ${JOB_SHAPE} }`,
        errors: [
          { status: 404, error: "not_found", when: "no deck job has that id" },
          { status: 409, error: "not_ready", when: "the job is running, or already published or discarded" },
        ],
      },
      {
        method: "POST",
        path: "/api/mimir/studio/concepts/{id}/regenerate",
        summary: "Has Claude make a concept's video afresh, or its first.",
        access: "mimirStudio",
        token: true,
        notes: `The job is given every accepted comment on the concept's video (up to ${VIDEO_NOTES_MAX}), each as where in the video it was made, the rating and the words, and writes the script and scenes by the explainer standards, starting from what the last video was made from. When it succeeds the concept's video is the new one, under a new name, so a page still playing the old one is not cut off, and those comments are marked applied. started is false when the studio could not be started; the job is then failed, with why.`,
        params: [{ name: "id", type: "string", required: true, note: "the concept's id" }],
        returns: `{ job: ${JOB_SHAPE}, started: boolean }, with 201`,
        errors: [
          { status: 404, error: "not_found", when: "no concept on the map has that id" },
          { status: 409, error: "busy", when: "a video for this concept is already under way" },
          { status: 503, error: "not_configured", when: "this deployment has no bucket or no studio job" },
        ],
      },
      {
        method: "GET",
        path: "/api/mimir/studio/jobs",
        summary: "Lists Mimir Studio's jobs, decks and videos, a page at a time, the newest first.",
        access: "mimirStudio",
        token: true,
        query: [
          { name: "kind", type: `"deck" | "video"`, note: "only that kind of job" },
          { name: "concept", type: "string", note: "only video jobs for the concept with this id" },
          ...listQuery(MIMIR_STUDIO_JOB_LIST.sorts, "the deck's file name or the concept's name", "desc"),
        ],
        returns: `{ jobs: ${JOB_SHAPE}[], ${PAGE_FIELDS} }`,
      },
      {
        method: "GET",
        path: "/api/mimir/studio/jobs/{id}",
        summary: "Returns one Mimir Studio job and, for a deck ready to publish, what publishing it would change.",
        access: "mimirStudio",
        token: true,
        notes: "diff is null unless the job is a deck that is ready. A ready deck's result holds the draft map, its slide count and Claude's summary of what changed; a finished video's, its object, length in seconds and Claude's report.",
        params: [JOB_ID],
        returns: `{ job: ${JOB_SHAPE}, diff: ${DIFF_SHAPE} | null }`,
        errors: [{ status: 404, error: "not_found", when: "no job has that id" }],
      },
    ],
  },
  {
    id: "mimir-map",
    title: "Mimir map",
    intro:
      "The concept map, the video for each concept, and the coach that walks you through them in order. Anyone signed in reads the map, watches the videos and chats with the coach, and keeps their own progress; nobody sees anyone else's. A Training Administrator imports the map.",
    endpoints: [
      {
        method: "GET",
        path: "/api/mimir/map",
        summary: "Returns the concept map and where you stand on every concept in it.",
        access: "signedIn",
        token: true,
        notes:
          "map is null until a Training Administrator imports one. A concept's video holds only its length: where the file is kept and what the narrator says stay on the server. states has an entry for each concept you have progress on: resumeAt is where playing starts if you press play now (the beginning if you had reached the end), completed is kept once you have watched to the end, recommended is the coach asking you to watch the video before you move on, and points is your checklist for the concept as stored: the one the coach set out for you, or your ticks against the concept's own points. videos is false on a deployment with nowhere to keep them.",
        returns:
          "{ map: { version, title, lead, sections, slides, levels, buckets, concepts: { id, name, slides, explanation, points?: string[], video?: { seconds } }[] } | null, importedAt: string | null, states: { [conceptId]: { videoSeconds, videoFurthest, videoDuration, completed, mastered, recommended, points: { text, covered }[] | null, resumeAt } }, videos: boolean }",
      },
      {
        method: "POST",
        path: "/api/mimir/map/import",
        summary: "Imports the concept map from a JSON file, replacing the one there.",
        access: "trainingAdmin",
        token: true,
        notes:
          "The file is validated whole and written whole, or refused. Progress is keyed by concept id, so everyone's progress on a concept the new map keeps carries over. frontend/scripts/mimir-map-convert.ts makes such a file from the course data and the videos' scripts. The content is private, so the file is never committed.",
        body: { kind: "multipart", fields: [{ name: "file", type: "file", required: true, note: "JSON, at most 8 MB" }] },
        returns: "{ ok: true, concepts: number, videos: number }",
        errors: [
          { status: 400, error: "no_file", when: "there is no file field" },
          { status: 400, error: "not_json", when: "the file is not JSON" },
          { status: 400, error: "invalid", when: "the file does not fit the map's shape; path and message say where" },
          { status: 413, error: "too_large", when: "the file is over 8 MB" },
        ],
      },
      {
        method: "GET",
        path: "/api/mimir/map/concepts/{id}/video",
        summary: "Returns a link to play a concept's video, and where to start.",
        access: "signedIn",
        token: true,
        notes:
          "url is a signed Cloud Storage link, good for expiresInSeconds, that the browser plays directly, so seeking works. startAt is where you left off, or 0 if you had reached the end or have not started.",
        params: [{ name: "id", type: "string", required: true, note: "the concept's id" }],
        returns: "{ url, expiresInSeconds, name, seconds, startAt, state }",
        errors: [
          { status: 404, error: "not_found", when: "no concept has that id, or it has no video" },
          { status: 404, error: "missing", when: "the video's file is not in the bucket" },
          { status: 503, error: "not_configured", when: "this deployment has nowhere to keep videos" },
        ],
      },
      {
        method: "GET",
        path: "/api/mimir/map/slides/{n}",
        summary: "Redirects to a slide's picture, which the map shows when you point at the slide.",
        access: "signedIn",
        token: true,
        notes: "The redirect goes to a signed Cloud Storage link, good for an hour, and may be cached for most of that. The pictures are uploaded per environment, so a slide can have none.",
        params: [{ name: "n", type: "number", required: true, note: "the slide's number, 1 to 200" }],
        returns: "a 302 to the JPEG",
        errors: [
          { status: 404, error: "not_found", when: "n is not a slide number" },
          { status: 404, error: "missing", when: "that slide has no picture in the bucket" },
          { status: 503, error: "not_configured", when: "this deployment has nowhere to keep pictures" },
        ],
      },
      {
        method: "PUT",
        path: "/api/mimir/map/concepts/{id}/video",
        summary: "Saves where you are in a concept's video.",
        access: "signedIn",
        token: true,
        notes:
          "The player sends it every 30 seconds while playing, when you pause or seek, when the video ends and when you leave. Reaching the end (ended, or all but the last 5%) marks the video completed, and that is kept if you watch again. A position at the end makes the next play start over.",
        params: [{ name: "id", type: "string", required: true, note: "the concept's id" }],
        body: {
          kind: "json",
          fields: [
            { name: "position", type: "number", required: true, note: "seconds from the start" },
            { name: "duration", type: "number", required: true, note: "the video's length in seconds, as the player reports it" },
            { name: "ended", type: "boolean", note: "true when the video has played through" },
          ],
        },
        returns: "{ state: { videoSeconds, videoFurthest, videoDuration, completed, mastered, recommended, resumeAt } }",
        errors: [
          { status: 400, error: "invalid", when: "position or duration is missing or out of range" },
          { status: 404, error: "not_found", when: "no concept has that id, or it has no video" },
        ],
      },
      {
        method: "GET",
        path: "/api/mimir/coach",
        summary: "Returns your conversation with the Mimir coach and how far through the course you are.",
        access: "signedIn",
        token: true,
        notes:
          "messages holds the latest 100 turns; earlier is true when older ones come before them, which before= reads a page at a time. needsGreeting is true when the page should ask the coach to greet you: you have no conversation yet, it has been a while, or your progress has moved (a video finished, say). configured is false when the server has no Claude key: the conversation reads but the coach cannot reply. progress.next is the lowest-numbered concept you have not mastered, and its points are the checklist you are being checked on, each covered once you have said it, or null before the coach has set one out. A conversation started before checklists reads as none, and the next greeting or message starts a new one.",
        query: [{ name: "before", type: "integer", note: "The page of turns before this seq, for reading back further." }],
        returns: `{ hasMap: boolean, configured: boolean, conversation: { startedAt, messages: ${MESSAGE_SHAPE}[], earlier: boolean } | null, needsGreeting: boolean, progress: { mastered, total, next: { id, name, hasVideo, points: { text, covered }[] | null } | null } }`,
      },
      {
        method: "POST",
        path: "/api/mimir/coach",
        summary: "Sends the coach a message, or asks it to greet you, and returns its reply.",
        access: "signedIn",
        token: true,
        notes:
          "Send { message } to say something, or { open: true } to have the coach greet you, say where you are and ask about the next concept. The coach checks what you know of each concept in turn, against a checklist of its main points: the concept's own, or one it sets out the first time it asks. It ticks each point once you have put it in your own words, in whichever message, and the ticks are kept. When every point is ticked the concept is mastered and it moves on; when you do not know the concept it links its video and marks it recommended. mastered and recommended list the concept ids it changed; covered lists, per concept, the points this reply ticked and how many of its checklist are now covered. The coach is Claude Sonnet 5.5; a request it declines is answered by Anthropic's fallback model, and when it can't be reached, by Claude Haiku 4.5. Send Accept: text/event-stream to have the reply streamed as it is written — text events with each delta, restart if it begins again on the fallback model, then done with the body below, or error with { error, status } — otherwise the whole reply comes back as JSON.",
        body: {
          kind: "json",
          fields: [
            { name: "message", type: "string", note: `up to ${MIMIR_MESSAGE_MAX} characters; give this or open` },
            { name: "open", type: "true", note: "ask the coach to greet you instead of saying something" },
          ],
        },
        returns: `{ messages: ${MESSAGE_SHAPE}[] (yours, if you said something, and the coach's), progress, mastered: string[], recommended: string[], covered: { id, points: string[], covered: number, total: number }[] }`,
        errors: [
          { status: 400, error: "invalid", when: "neither a message nor open is given, or the message is empty or too long" },
          { status: 409, error: "no_map", when: "no map has been imported, so there is nothing to coach on" },
          { status: 409, error: "busy", when: "the coach is still replying to your last message" },
          { status: 409, error: "full", when: "the conversation is as long as the model can read; start a new one" },
          { status: 422, error: "refused", when: "Claude declined to reply; your message was not kept" },
          { status: 502, error: "upstream", when: "Claude could not be reached or returned nothing; your message was not kept" },
          { status: 503, error: "not_configured", when: "the server has no Claude key" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/mimir/coach",
        summary: "Throws away your conversation with the coach, so the next one starts afresh.",
        access: "signedIn",
        token: true,
        notes: "Your progress, mastery, checklists and videos watched stay.",
        returns: "{ ok: true, deleted: boolean }",
      },
    ],
  },
];
