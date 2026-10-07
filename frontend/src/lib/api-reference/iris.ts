/** The Iris placement tests: taking them, and what Iris administrators read and review. */

import { IRIS_NOTE_MAX } from "@/db/schema";
import { IRIS_COHORT_LIST } from "@/lib/list-specs";
import { PAGE_FIELDS, listQuery } from "./paging";
import type { EndpointGroup, Field } from "./types";

const SUBJECT_TYPE = `"sdlc" | "industry" | "sales" | "dealmech" | "cotm" | "techai" | "pipegen" | "compete"`;
const FORM_QUERY: Field = { name: "form", type: `"A" | "B"`, note: "Default A." };
const FORM_ERROR = { status: 400, error: "invalid_form", when: "form is neither A nor B" };
const SITTING_SHAPE = `{ attemptId, subject, form: "A" | "B", mode: "live" | "preview", number, progress, question: { stem, options: string[] } }`;
const SITTING_ID: Field = { name: "id", type: "string", required: true, note: "the sitting's attemptId" };

export const IRIS_GROUPS: EndpointGroup[] = [
  {
    id: "iris",
    title: "Iris",
    intro:
      "Adaptive placement tests, one per subject. The engine runs on the server: a taker is sent one question at a time without its answer, and posts a choice to get the next. Takers never see their placement.",
    endpoints: [
      {
        method: "GET",
        path: "/api/iris/me",
        summary: "Returns your track and where you are with each subject.",
        access: "irisTaker",
        token: true,
        notes:
          "status is completed once you have finished a live sitting of the subject on this form, in_progress while one is open, available when it has enough approved questions to run, and unavailable otherwise. A finished subject carries placement (1 Beginner, 2 Intermediate, 3 Advanced) only when you are an Iris Administrator; a taker is never told their level.",
        query: [FORM_QUERY],
        returns: `{ track: "AE" | "SE" | "SDR" | null, form, subjects: { key, name, blurb, status: "available" | "in_progress" | "completed" | "unavailable", placement?: 1 | 2 | 3 }[], completed: number }`,
        errors: [FORM_ERROR],
      },
      {
        method: "PUT",
        path: "/api/iris/me/track",
        summary: "Sets the track you sell in, which weights your overall score.",
        access: "irisTaker",
        token: true,
        body: { kind: "json", fields: [{ name: "track", type: `"AE" | "SE" | "SDR"`, required: true }] },
        returns: "{ ok: true, track }",
        errors: [{ status: 400, error: "invalid_body", when: "track is not one of the three" }],
      },
      {
        method: "POST",
        path: "/api/iris/sittings",
        summary: "Starts a sitting of one subject, or picks up the one in progress.",
        access: "irisTaker",
        token: true,
        notes:
          "A live sitting draws only approved questions and is taken once per subject and form. A preview draws every question not rejected, is never reported, can be taken any number of times, and needs an Iris Administrator. 201 for a new sitting, 200 with resumed: true for the one already open.",
        body: {
          kind: "json",
          fields: [
            { name: "subject", type: SUBJECT_TYPE, required: true },
            { name: "form", type: `"A" | "B"`, note: "Default A." },
            { name: "mode", type: `"live" | "preview"`, note: "Default live." },
          ],
        },
        returns: `201 { sitting: ${SITTING_SHAPE}, resumed: false }, or 200 with resumed: true`,
        errors: [
          { status: 400, error: "invalid_body", when: "the body does not parse" },
          { status: 403, error: "forbidden", when: "a preview, and you are not an Iris Administrator" },
          { status: 409, error: "no_track", when: "a live sitting before you have set your track" },
          { status: 409, error: "already_taken", when: "you have finished a live sitting of this subject and form" },
          { status: 409, error: "not_ready", when: "too few approved questions to run it" },
        ],
      },
      {
        method: "GET",
        path: "/api/iris/sittings/{id}",
        summary: "Returns the question on screen in one of your open sittings.",
        access: "irisTaker",
        token: true,
        params: [SITTING_ID],
        returns: `{ sitting: ${SITTING_SHAPE} }`,
        errors: [{ status: 404, error: "not_found", when: "no open sitting of yours has that id" }],
      },
      {
        method: "POST",
        path: "/api/iris/sittings/{id}/answers",
        summary: "Answers the question on screen and returns the next one.",
        access: "irisTaker",
        token: true,
        notes:
          "A question is sent as its wording and options only, never its id or level. choice is the option's index from 0, or -1 for \"I don't know\", which is graded as wrong. A sitting ends after 10 to 14 questions plus up to 3 tiebreak questions; the last answer returns done: true, and the placement and confidence only to an Iris Administrator.",
        params: [SITTING_ID],
        body: {
          kind: "json",
          fields: [
            { name: "number", type: "integer", required: true, note: "the sitting's number for the question being answered" },
            { name: "choice", type: "-1 | 0 | 1 | 2 | 3", required: true },
          ],
        },
        returns: `{ done: false, sitting: ${SITTING_SHAPE} } or { done: true, subject, mode, questions: number, placement?: 1 | 2 | 3, confidence?: "high" | "medium" | "low" }`,
        errors: [
          { status: 400, error: "invalid_body", when: "the body does not parse" },
          { status: 400, error: "invalid_choice", when: "choice is not -1 to 3" },
          { status: 404, error: "not_found", when: "no sitting of yours has that id" },
          { status: 409, error: "finished", when: "the sitting is over" },
          { status: 409, error: "stale", when: "number is not the question on screen; the body carries the current sitting" },
        ],
      },
      {
        method: "GET",
        path: "/api/iris/cohort",
        summary: "Lists everyone with a finished live sitting on one form, with their placements, a page at a time.",
        access: "irisAdmin",
        token: true,
        notes:
          "placements maps each subject finished to a level: 1 Beginner, 2 Intermediate, 3 Advanced. composite is the share of the top level reached, weighted for the person's track, 0 to 100, and null without a track or a weighted subject. Previews are never listed.",
        query: [FORM_QUERY, ...listQuery(IRIS_COHORT_LIST.sorts, "the name or email", "desc")],
        returns: `{ people: { userId, name, email, track, placements: Record<subject, 1 | 2 | 3>, completed: number, composite: number | null, finishedAt }[], ${PAGE_FIELDS} }`,
        errors: [FORM_ERROR],
      },
      {
        method: "GET",
        path: "/api/iris/cohort/{id}",
        summary: "Returns one person's live sittings on one form, each with every answer in order.",
        access: "irisAdmin",
        token: true,
        notes:
          "chosen is null for \"I don't know\". stem and chosen.text are null for an answer given to an older version of a question.",
        params: [{ name: "id", type: "string", required: true, note: "the user's id" }],
        query: [FORM_QUERY],
        returns:
          "{ userId, name, email, track, form, composite, sittings: { subject, placement, confidence: \"high\" | \"medium\" | \"low\" | null, questions, startedAt, finishedAt, answers: { seq, itemId, itemVersion, level, phase: \"main\" | \"tiebreak\", stem, chosen: { index, text } | null, correct, ms }[] }[] }",
        errors: [FORM_ERROR, { status: 404, error: "not_found", when: "no such user" }],
      },
      {
        method: "DELETE",
        path: "/api/iris/cohort/{id}",
        summary: "Deletes every Iris sitting one person has, so they can take the subjects again.",
        access: "irisAdmin",
        token: true,
        notes: "Every subject, every form, finished or not. Irreversible.",
        params: [{ name: "id", type: "string", required: true, note: "the user's id" }],
        returns: "{ ok: true, deleted: number }",
        errors: [{ status: 404, error: "not_found", when: "no such user" }],
      },
      {
        method: "GET",
        path: "/api/iris/questions",
        summary: "Lists one subject's questions on one form, with their keys, reviews and live statistics.",
        access: "irisAdmin",
        token: true,
        notes:
          "At most 38 questions, in bank order. A question nobody has reviewed in its current version is a draft. Statistics count live sittings of the current version only. calibration reads too_easy above 85% correct and too_hard below 45% once 20 have answered; dead_distractors lists wrong options nobody has chosen once 10 have.",
        query: [
          { name: "subject", type: SUBJECT_TYPE, required: true },
          FORM_QUERY,
          { name: "level", type: "1 | 2 | 3", note: "One level only." },
          { name: "status", type: `"approved" | "rejected" | "draft"`, note: "One review state only." },
        ],
        returns:
          "{ questions: { id, version, level, subtopic, stem, options, answer, rationale, review: { status, note, reviewer, updatedAt }, stats: { responses, correct, dontKnow, picks: [a, b, c, d], medianMs }, calibration: { kind, ... } }[], counts: { approved, rejected, draft } }",
        errors: [
          { status: 400, error: "invalid_subject", when: "subject is missing or unknown" },
          FORM_ERROR,
          { status: 400, error: "invalid_level", when: "level is not 1, 2 or 3" },
          { status: 400, error: "invalid_status", when: "status is not a review state" },
        ],
      },
      {
        method: "PUT",
        path: "/api/iris/questions/{id}/review",
        summary: "Approves, rejects or returns to draft one question's current version.",
        access: "irisAdmin",
        token: true,
        notes: "Only an approved question is served in a live sitting. Leaving note out keeps the one already there.",
        params: [{ name: "id", type: "string", required: true, note: "the question's id, such as sdlc-l1-01" }],
        body: {
          kind: "json",
          fields: [
            { name: "status", type: `"approved" | "rejected" | "draft"`, required: true },
            { name: "note", type: "string", note: `up to ${IRIS_NOTE_MAX} characters` },
          ],
        },
        returns: "{ ok: true, status }",
        errors: [
          { status: 400, error: "invalid_body", when: "the body does not parse" },
          { status: 404, error: "not_found", when: "no question has that id" },
        ],
      },
      {
        method: "POST",
        path: "/api/iris/questions/approve-drafts",
        summary: "Approves every draft question on one subject and form at once.",
        access: "irisAdmin",
        token: true,
        notes: "Rejected questions stay rejected.",
        body: {
          kind: "json",
          fields: [
            { name: "subject", type: SUBJECT_TYPE, required: true },
            { name: "form", type: `"A" | "B"`, note: "Default A." },
          ],
        },
        returns: "{ ok: true, approved: number }",
        errors: [{ status: 400, error: "invalid_body", when: "the body does not parse" }],
      },
    ],
  },
];
