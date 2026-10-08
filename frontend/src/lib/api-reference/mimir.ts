/** Mimir: the reference library and its coach, for everyone; its content and coaching settings, for Training Administrators. */

import {
  MIMIR_KINDS,
  MIMIR_MESSAGE_MAX,
  MIMIR_REFLECTION_MAX,
  MIMIR_SETTING_MAX,
} from "@/db/schema";
import { MIMIR_ITEM_LIST, MIMIR_PROGRESS_LIST } from "@/lib/list-specs";
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
const ITEM_ERRORS = [
  { status: 400, error: "invalid", when: "the body does not parse" },
  { status: 400, error: "bad_parent", when: "parentId names no item, or one this kind may not sit under" },
];

export const MIMIR_GROUPS: EndpointGroup[] = [
  {
    id: "mimir",
    title: "Mimir",
    intro:
      "The GTM reference library and its AI coach: Harness's four agents and the capabilities each is made of, personas, competitors, proof points and more. Anyone signed in reads the content, is coached on it, and keeps their own progress; nobody sees anyone else's. Training Administrators edit the content and the coaching settings.",
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
        notes: "Kept apart from your Iris track. Conversations already under way keep the prompt they started with.",
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
];
