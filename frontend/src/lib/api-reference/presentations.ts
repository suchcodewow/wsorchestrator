/** Training → Presentations: Google Slides decks to present full screen, with their speaker notes. */

import { PRESENTATION_LIMITS } from "@/db/schema";
import { PRESENTATION_LIST } from "@/lib/list-specs";
import { listQuery, PAGE_FIELDS } from "./paging";
import type { Endpoint, EndpointGroup } from "./types";

const ROW = "{ id, name, googleTitle, slides: number, syncedAt: ISO 8601 string }";
const SLIDE = "{ id, number: number, googlePageId, skipped: boolean, notes: string, version: string, cached: boolean }";
const idParam = [{ name: "id", type: "string", required: true, note: "the presentation's id" }];

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
        summary: "Reads one presentation with every slide of its deck, in order, and their speaker notes.",
        access: "trainingViewer",
        token: true,
        notes:
          "Skipped slides are included, so number matches Google's numbering, but are never presented. version changes whenever the slide does; cached says its picture is already here. googleUrl opens the deck in Google.",
        params: idParam,
        returns: `{ id, name, googleFileId, googleTitle, googleUrl, syncedAt, createdAt, createdBy: string | null, slides: ${SLIDE}[] }`,
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
    ],
  },
];
