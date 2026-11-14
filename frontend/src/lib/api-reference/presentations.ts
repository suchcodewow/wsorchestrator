/** Training → Presentations: Google Slides decks to present full screen, with their speaker notes. */

import { PRESENTATION_LIMITS } from "@/db/schema";
import { PRESENTATION_LIST } from "@/lib/list-specs";
import { ELEMENT_KINDS, FONTS, PAGE_LIMITS, REVEAL_EFFECTS, STAGE } from "@/lib/presentations/page";
import { listQuery, PAGE_FIELDS } from "./paging";
import type { Endpoint, EndpointGroup } from "./types";

const ROW = "{ id, name, googleTitle, slides: number, syncedAt: ISO 8601 string }";
const SLIDE = "{ id, number: number, googlePageId, skipped: boolean, notes: string, version: string, cached: boolean }";
const PAGE = "{ id, before: string | null, position: number, document: PageDocument, notes: string, updatedAt: ISO 8601 string }";
const DOCUMENT_NOTE = `PageDocument is { background: "#rrggbb", elements: Element[] } on a ${STAGE.width}×${STAGE.height} stage, at most ${PAGE_LIMITS.elements} elements, drawn in order so the last is on top. An Element is { id, kind: ${ELEMENT_KINDS.map((k) => `"${k}"`).join(" | ")}, x, y, w, h, rotation, fill: colour | null, stroke: colour | null, strokeWidth, radius, text, font: ${FONTS.map((f) => `"${f}"`).join(" | ")}, fontSize, bold, textColor, align: "left" | "center" | "right", valign: "top" | "middle" | "bottom", reveal }, sizes in stage pixels. reveal is null (always shown), { on: "next", order, effect } (shown by a press of next, lowest order first, those sharing an order together), or { on: "click", by, effect } (shown by a click on the element whose id is by, and hidden by a second); effect is ${REVEAL_EFFECTS.map((e) => `"${e}"`).join(", ")}.`;
const idParam = [{ name: "id", type: "string", required: true, note: "the presentation's id" }];
const pageParams = [...idParam, { name: "pageId", type: "string", required: true, note: "the page's id" }];
const before = {
  name: "before",
  type: "string | null",
  required: true,
  note: "the googlePageId of the slide the page comes before; null for last",
};

const GOOGLE_ERRORS: NonNullable<Endpoint["errors"]> = [
  {
    status: 422,
    error: "google_cannot_open",
    when: "the connected Google account cannot open the deck: a wrong link, or it is not shared with that account",
  },
  { status: 422, error: "too_many_slides", when: `the deck has more than ${PRESENTATION_LIMITS.slides} slides` },
  { status: 502, error: "failed", when: "Google answered with an error, or could not be reached" },
  {
    status: 503,
    error: "google_not_connected",
    when: "no Google account is connected under Admin Settings → External Connectors (also google_not_configured, google_reconnect)",
  },
];

export const PRESENTATIONS_GROUPS: EndpointGroup[] = [
  {
    id: "presentations",
    title: "Presentations",
    intro:
      "Google Slides decks to present full screen, with a speaker-notes view. The deck stays in Google and is never changed: it is read, as the Google account connected under Admin Settings → External Connectors, when it is added and whenever it is refreshed, so that account must be able to open it. Each slide's picture is fetched from Google the first time it is asked for and kept until the slide changes in Google. Training Viewers present and read; Training Administrators add, refresh, rename and remove.",
    endpoints: [
      {
        method: "GET",
        path: "/api/presentations",
        summary: "Lists presentations, a page at a time.",
        access: "trainingViewer",
        token: true,
        notes:
          "slides counts the slides that are presented: the deck's, less any skipped in Google. syncedAt is when the deck was last read from Google.",
        query: listQuery(PRESENTATION_LIST.sorts, "the name or the deck's title in Google"),
        returns: `{ presentations: ${ROW}[], ${PAGE_FIELDS} }`,
      },
      {
        method: "POST",
        path: "/api/presentations",
        summary: "Adds a presentation of a Google Slides deck, reading its slides and speaker notes from Google.",
        access: "trainingAdmin",
        token: true,
        notes: "Slide pictures are not fetched here; each is fetched the first time it is shown.",
        body: {
          kind: "json",
          fields: [
            { name: "name", type: "string", required: true, note: `trimmed; 1 to ${PRESENTATION_LIMITS.name} characters` },
            {
              name: "link",
              type: "string",
              required: true,
              note: "the deck's address in Google Slides (docs.google.com/presentation/d/…), or its bare Drive id",
            },
          ],
        },
        returns: "201 { id, slides: number }",
        errors: [
          { status: 400, error: "invalid", when: "no name, or the link is not a Google Slides link; issues lists each problem" },
          ...GOOGLE_ERRORS,
        ],
      },
      {
        method: "GET",
        path: "/api/presentations/{id}",
        summary: "Reads one presentation with every slide of its deck, in order, its own pages, and their speaker notes.",
        access: "trainingViewer",
        token: true,
        notes:
          "Skipped slides are included, so number matches Google's numbering, but are never presented. version changes whenever the slide does; cached says its picture is already here. googleUrl opens the deck in Google. Each page is shown just before the slide whose googlePageId its before names, pages before the same slide in position order; one whose before is null, or names a slide no longer in the deck, is shown last.",
        params: idParam,
        returns: `{ id, name, googleFileId, googleTitle, googleUrl, syncedAt, createdAt, createdBy: string | null, slides: ${SLIDE}[], pages: ${PAGE}[] }`,
        errors: [{ status: 404, error: "not_found", when: "no such presentation" }],
      },
      {
        method: "PATCH",
        path: "/api/presentations/{id}",
        summary: "Renames a presentation.",
        access: "trainingAdmin",
        token: true,
        notes: "The deck's title in Google is left alone.",
        params: idParam,
        body: {
          kind: "json",
          fields: [{ name: "name", type: "string", required: true, note: `trimmed; 1 to ${PRESENTATION_LIMITS.name} characters` }],
        },
        returns: "{ ok: true, name }",
        errors: [
          { status: 400, error: "invalid", when: "no name" },
          { status: 404, error: "not_found", when: "no such presentation" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/presentations/{id}",
        summary: "Removes a presentation and every slide kept for it.",
        access: "trainingAdmin",
        token: true,
        notes: "The deck in Google is not touched.",
        params: idParam,
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "no such presentation" }],
      },
      {
        method: "POST",
        path: "/api/presentations/{id}/sync",
        summary: "Reads the presentation's deck from Google again.",
        access: "trainingAdmin",
        token: true,
        notes:
          "Slides added, removed, reordered or skipped in Google, and every change to the speaker notes, take effect at once. changed counts the slides that are new or look different; each gets a new picture the next time it is shown. No body.",
        params: idParam,
        returns: "{ ok: true, slides: number, changed: number }",
        errors: [{ status: 404, error: "not_found", when: "no such presentation" }, ...GOOGLE_ERRORS],
      },
      {
        method: "GET",
        path: "/api/presentations/{id}/slides/{slideId}/image",
        summary: "Serves a slide's picture as WebP, 2000 pixels wide.",
        access: "trainingViewer",
        token: true,
        notes:
          "Fetched from Google the first time it is asked for, and kept until the slide changes; one server fetches at most one picture every 1.1 seconds, inside Google's limit, so a deck's first showing can wait. Asked with ?v=<the slide's version>, a current picture is cached for good. If Google cannot be reached the last picture kept is served.",
        params: [...idParam, { name: "slideId", type: "string", required: true, note: "the slide's id" }],
        query: [{ name: "v", type: "string", note: "the slide's version, so a browser may cache the picture" }],
        returns: "the image bytes",
        errors: [
          { status: 404, error: "not_found", when: "no such presentation or slide" },
          ...GOOGLE_ERRORS.filter((e) => e.error !== "too_many_slides"),
        ],
      },
      {
        method: "POST",
        path: "/api/presentations/{id}/pages",
        summary: "Adds one of the presentation's own pages, blank and white, before a slide of its deck.",
        access: "trainingAdmin",
        token: true,
        notes: `A page added before a slide that already has some goes after them. A presentation holds at most ${PRESENTATION_LIMITS.pages} pages.`,
        params: idParam,
        body: { kind: "json", fields: [before] },
        returns: "201 { id }",
        errors: [
          { status: 400, error: "invalid", when: "before is missing" },
          { status: 404, error: "not_found", when: "no such presentation" },
          { status: 422, error: "too_many_pages", when: `the presentation already has ${PRESENTATION_LIMITS.pages} pages` },
        ],
      },
      {
        method: "GET",
        path: "/api/presentations/{id}/pages/{pageId}",
        summary: "Reads one of the presentation's own pages.",
        access: "trainingViewer",
        token: true,
        notes: DOCUMENT_NOTE,
        params: pageParams,
        returns: PAGE,
        errors: [{ status: 404, error: "not_found", when: "no such presentation or page" }],
      },
      {
        method: "PUT",
        path: "/api/presentations/{id}/pages/{pageId}",
        summary: "Saves one of the presentation's own pages whole: its drawing, its speaker notes, and the slide it comes before.",
        access: "trainingAdmin",
        token: true,
        notes: `${DOCUMENT_NOTE} A page moved to another slide goes after the pages already there.`,
        params: pageParams,
        body: {
          kind: "json",
          fields: [
            before,
            { name: "document", type: "PageDocument", required: true, note: "the whole drawing, replacing the one before" },
            { name: "notes", type: "string", required: true, note: `the speaker notes; up to ${PAGE_LIMITS.notes} characters` },
          ],
        },
        returns: "{ ok: true }",
        errors: [
          {
            status: 400,
            error: "invalid",
            when: "the body does not parse: an element's id repeats, a reveal names no element on the page or the element itself, a colour is not #rrggbb; issues lists each problem's path",
          },
          { status: 404, error: "not_found", when: "no such presentation or page" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/presentations/{id}/pages/{pageId}",
        summary: "Removes one of the presentation's own pages.",
        access: "trainingAdmin",
        token: true,
        params: pageParams,
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "no such presentation or page" }],
      },
    ],
  },
];
