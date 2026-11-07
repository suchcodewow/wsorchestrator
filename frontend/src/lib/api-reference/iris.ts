/** The Diagnostic placement tests: taking them, who its Participants are, and what Assessments Administrators read and review. */

import { IRIS_NOTE_MAX, VIDEO_FEEDBACK_LIMITS } from "@/db/schema";
import { SUBJECT_KEYS } from "@/lib/iris/subjects";
import { IRIS_FEEDBACK_LIST, IRIS_PARTICIPANT_LIST, IRIS_RECORD_LIST, IRIS_REMINDER_MESSAGE_LIST, IRIS_REMINDER_RUN_LIST } from "@/lib/list-specs";
import { PAGE_FIELDS, listQuery } from "./paging";
import type { EndpointGroup, Field } from "./types";

const SUBJECT_TYPE = SUBJECT_KEYS.map((k) => `"${k}"`).join(" | ");
const FORM_QUERY: Field = { name: "form", type: `"A" | "B"`, note: "Default A." };
const FORM_ERROR = { status: 400, error: "invalid_form", when: "form is neither A nor B" };
const SITTING_SHAPE = `{ attemptId, subject, form: "A" | "B", mode: "live" | "preview", number, progress, question: { stem, options: string[] } }`;
const FEEDBACK_SHAPE = `{ id, attemptId: string | null, subject: ${SUBJECT_TYPE}, mode: "live" | "preview", number, itemId, stem, rating: "up" | "down", comment: string | null, createdAt, user: { name, email } | null, closedAt: string | null, closedBy: { name, email } | null, answers: { options: string[], correct: 0 | 1 | 2 | 3, chosen: -1 | 0 | 1 | 2 | 3 | null, reworded: boolean } | null }`;
const SITTING_ID: Field = { name: "id", type: "string", required: true, note: "the sitting's attemptId" };

export const IRIS_GROUPS: EndpointGroup[] = [
  {
    id: "iris",
    title: "Diagnostic",
    intro:
      "Adaptive placement tests, one per subject, for its Participants only: whoever an Assessments Administrator adds by hand, and, while Bootcamp Auto-Enroll is on, every bootcamp candidate on the Sales or Engineer track who has RSVP'd. Roles alone do not let anyone take them. The engine runs on the server: a taker is sent one question at a time without its answer, and posts a choice to get the next. Takers never see their placement.",
    endpoints: [
      {
        method: "GET",
        path: "/api/diagnostic/me",
        summary: "Returns your track and where you are with each subject.",
        access: "participant",
        token: true,
        notes:
          "status is completed once you have finished a live sitting of the subject on this form, in_progress while one is open, available when it has enough approved questions to run, and unavailable otherwise. Subjects with no questions yet are not listed. open counts the listed subjects. A finished subject carries placement (1 for 101, 2 for 201, 3 for 301) only when you are an Assessments Administrator; a taker is never told their level.",
        query: [FORM_QUERY],
        returns: `{ track: "AE" | "SE" | "SDR" | null, form, subjects: { key, name, blurb: string | null, status: "available" | "in_progress" | "completed" | "unavailable", placement?: 1 | 2 | 3 }[], completed: number, open: number }`,
        errors: [FORM_ERROR],
      },
      {
        method: "PUT",
        path: "/api/diagnostic/me/track",
        summary: "Sets the track you sell in, which weights your overall score.",
        access: "participant",
        token: true,
        body: { kind: "json", fields: [{ name: "track", type: `"AE" | "SE" | "SDR"`, required: true }] },
        returns: "{ ok: true, track }",
        errors: [{ status: 400, error: "invalid_body", when: "track is not one of the three" }],
      },
      {
        method: "POST",
        path: "/api/diagnostic/sittings",
        summary: "Starts a sitting of one subject, or picks up the one in progress.",
        access: "diagnosticSitter",
        token: true,
        notes:
          "A live sitting draws only approved questions and is taken once per subject and form. A preview draws every question not rejected, is never reported, can be taken any number of times, and needs an Assessments Administrator. 201 for a new sitting, 200 with resumed: true for the one already open.",
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
          { status: 403, error: "forbidden", when: "a live sitting and you are not a Participant, or a preview and you are not an Assessments Administrator" },
          { status: 409, error: "no_track", when: "a live sitting before you have set your track" },
          { status: 409, error: "already_taken", when: "you have finished a live sitting of this subject and form" },
          { status: 409, error: "not_ready", when: "too few approved questions to run it, or a subject with none yet" },
        ],
      },
      {
        method: "GET",
        path: "/api/diagnostic/sittings/{id}",
        summary: "Returns the question on screen in one of your open sittings.",
        access: "diagnosticSitter",
        token: true,
        params: [SITTING_ID],
        returns: `{ sitting: ${SITTING_SHAPE} }`,
        errors: [{ status: 404, error: "not_found", when: "no open sitting of yours has that id, or it is live and you are no longer a Participant" }],
      },
      {
        method: "POST",
        path: "/api/diagnostic/sittings/{id}/answers",
        summary: "Answers the question on screen and returns the next one.",
        access: "diagnosticSitter",
        token: true,
        notes:
          "A question is sent as its wording and options only, never its id or level. Each taker sees the options in their own shuffled order, and choice is the position on their screen, from 0, or -1 for \"I don't know\", which is graded as wrong. A sitting ends after 10 to 14 questions plus up to 3 tiebreak questions; the last answer returns done: true, and the placement and confidence only to an Assessments Administrator.",
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
          { status: 404, error: "not_found", when: "no sitting of yours has that id, or it is live and you are no longer a Participant" },
          { status: 409, error: "finished", when: "the sitting is over" },
          { status: 409, error: "stale", when: "number is not the question on screen; the body carries the current sitting" },
        ],
      },
      {
        method: "POST",
        path: "/api/diagnostic/feedback",
        summary: "Rates the question on screen in one of your open sittings with a smiley or confused face, with a comment if you like.",
        access: "diagnosticSitter",
        token: true,
        notes:
          "The question is the one on screen in the sitting named, worked out on the server; its id, version and wording are kept with the rating. Rating the same question again adds another rating; nothing is replaced, and the sitting is not moved on.",
        body: {
          kind: "json",
          fields: [
            { name: "attemptId", type: "string", required: true, note: "the sitting's attemptId" },
            { name: "number", type: "integer", required: true, note: "the sitting's number for the question on screen" },
            { name: "rating", type: `"up" | "down"`, required: true, note: "up is the smiley face, down the confused one" },
            { name: "comment", type: "string", note: `up to ${VIDEO_FEEDBACK_LIMITS.comment} characters, trimmed; blank is no comment` },
          ],
        },
        returns: `201 { feedback: ${FEEDBACK_SHAPE} }`,
        errors: [
          { status: 400, error: "invalid_body", when: "the body does not parse" },
          { status: 404, error: "not_found", when: "no sitting of yours has that id, or it is live and you are no longer a Participant" },
          { status: 409, error: "finished", when: "the sitting is over" },
          { status: 409, error: "stale", when: "number is not the question on screen" },
        ],
      },
      {
        method: "GET",
        path: "/api/diagnostic/feedback",
        summary: "Lists the ratings given while taking a test, with any comment and the question they were about, a page at a time, the newest first.",
        access: "assessmentsAdmin",
        token: true,
        notes: "number is the question's place in its sitting, from 1. itemId and stem are the question as it was when rated. Previews' ratings are included, with mode preview. Closed ratings are left out unless closed=1. user is null once the account that gave it is deleted, and closedBy likewise, or while it is open. answers has the question's options in the bank's order (not the taker's shuffled order), the correct one, and chosen, what the taker went on to answer: -1 for \"I don't know\", null before they answer or once the sitting is reset (attemptId is then null too). reworded is true when the question has changed since it was rated. answers is null for a question no longer in the bank.",
        query: [
          ...listQuery(IRIS_FEEDBACK_LIST.sorts, "the comment, the question, or the name or email of who gave it", "desc"),
          { name: "closed", type: `"1"`, note: "1 includes closed ratings; otherwise only open ones are listed." },
        ],
        returns: `{ feedback: ${FEEDBACK_SHAPE}[], ${PAGE_FIELDS} }`,
      },
      {
        method: "PATCH",
        path: "/api/diagnostic/feedback/{id}",
        summary: "Closes a rating given during a sitting, or opens it again.",
        access: "assessmentsAdmin",
        token: true,
        notes: "Closing records when and by whom; opening it again clears both.",
        params: [{ name: "id", type: "string", required: true, note: "the rating's id" }],
        body: { kind: "json", fields: [{ name: "closed", type: "boolean", required: true }] },
        returns: "{ ok: true, closed: boolean }",
        errors: [
          { status: 400, error: "invalid_body", when: "closed is not a boolean" },
          { status: 404, error: "not_found", when: "no rating has that id" },
        ],
      },
      {
        method: "GET",
        path: "/api/diagnostic/participants",
        summary: "Lists the Participants, with their placements on one form, a page at a time.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "Everyone added by hand, and while Bootcamp Auto-Enroll is on, every bootcamp candidate on the Sales or Engineer track who has RSVP'd by saving the Bootcamp intake form; manual is true for the first. userId is null for someone who has not signed in yet. placements maps each subject finished to a level: 1 for 101, 2 for 201, 3 for 301. composite is the share of the top level reached, weighted for the person's track, 0 to 100, and null without a track or a weighted subject. Previews are never counted. counts and autoEnroll are whatever the search.",
        query: [FORM_QUERY, ...listQuery(IRIS_PARTICIPANT_LIST.sorts, "the name or email")],
        returns: `{ people: { email, name, userId: string | null, manual: boolean, addedAt: string | null, addedBy: string | null, track, placements: Record<subject, 1 | 2 | 3>, completed: number, composite: number | null, finishedAt: string | null }[], counts: { total, manual, auto }, autoEnroll: { on: boolean, changedAt: string | null, changedBy: string | null }, ${PAGE_FIELDS} }`,
        errors: [FORM_ERROR],
      },
      {
        method: "POST",
        path: "/api/diagnostic/participants",
        summary: "Adds a Participant by hand.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "Someone on the employee list from HiBob, or with an account here such as a test account. Added by hand, they stay a Participant whether Bootcamp Auto-Enroll is on or off, until removed. track sets their Diagnostic track: at once if they have an account, replacing one they chose, and otherwise when they first sign in; null or left out leaves it to them.",
        body: {
          kind: "json",
          fields: [
            { name: "email", type: "string", required: true },
            { name: "track", type: `"AE" | "SE" | "SDR" | null`, note: "Default null." },
          ],
        },
        returns: "201 { ok: true, email, fullName }",
        errors: [
          { status: 400, error: "invalid", when: "email is missing or not an address" },
          { status: 400, error: "unknown_person", when: "nobody by that email is on the employee list or has an account" },
          { status: 409, error: "duplicate", when: "they were already added by hand" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/diagnostic/participants",
        summary: "Removes a Participant added by hand.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "Takes away the hand-added override only: someone Bootcamp Auto-Enroll counts stays a Participant through it. Their results are kept.",
        body: { kind: "json", fields: [{ name: "email", type: "string", required: true }] },
        returns: "{ ok: true }",
        errors: [
          { status: 400, error: "invalid", when: "email is missing or not an address" },
          { status: 404, error: "not_found", when: "nobody by that email was added by hand" },
        ],
      },
      {
        method: "GET",
        path: "/api/diagnostic/records",
        summary: "Lists everyone with a sitting on one form, Participant or not, with their placements, a page at a time.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "Everyone with a live sitting on the form, finished or not, including those no longer Participants: removing a Participant keeps their results. enrolled is whether they are a Participant now, and manual whether by hand. placements, completed and composite are as in GET /api/diagnostic/participants. Previews are never counted. total is whatever the search.",
        query: [FORM_QUERY, ...listQuery(IRIS_RECORD_LIST.sorts, "the name or email")],
        returns: `{ people: { email, name, userId: string, enrolled: boolean, manual: boolean, addedAt: string | null, addedBy: string | null, track, placements: Record<subject, 1 | 2 | 3>, completed: number, composite: number | null, finishedAt: string | null }[], total: number, ${PAGE_FIELDS} }`,
        errors: [FORM_ERROR],
      },
      {
        method: "GET",
        path: "/api/diagnostic/auto-enroll",
        summary: "Returns whether Bootcamp Auto-Enroll is on.",
        access: "assessmentsAdmin",
        token: true,
        returns: "{ on: boolean, changedAt: string | null, changedBy: string | null }",
      },
      {
        method: "PUT",
        path: "/api/diagnostic/auto-enroll",
        summary: "Turns Bootcamp Auto-Enroll on or off.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "On, every bootcamp candidate on the Sales or Engineer track who has RSVP'd is a Participant, and anyone who RSVPs later becomes one at once. Off, every one of them stops being a Participant and can no longer start or carry on a test; those added by hand stay.",
        body: { kind: "json", fields: [{ name: "on", type: "boolean", required: true }] },
        returns: "{ on, changedAt, changedBy, counts: { total, manual, auto } }",
        errors: [{ status: 400, error: "invalid_body", when: "on is not a boolean" }],
      },
      {
        method: "GET",
        path: "/api/diagnostic/results/{id}",
        summary: "Returns one person's live sittings on one form, each with every answer in order.",
        access: "assessmentsAdmin",
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
        path: "/api/diagnostic/results/{id}",
        summary: "Deletes every Diagnostic sitting one person has, so they can take the subjects again.",
        access: "assessmentsAdmin",
        token: true,
        notes: "Every subject, every form, finished or not. Irreversible. Whether they are a Participant does not change.",
        params: [{ name: "id", type: "string", required: true, note: "the user's id" }],
        returns: "{ ok: true, deleted: number }",
        errors: [{ status: 404, error: "not_found", when: "no such user" }],
      },
      {
        method: "DELETE",
        path: "/api/diagnostic/results/{id}/{subject}",
        summary: "Resets one person's live sitting of one subject, so they can take it again.",
        access: "assessmentsAdmin",
        token: true,
        notes: "Finished or in progress, with every answer in it. Their other subjects are kept. Irreversible, and recorded in the audit trail. deleted is 0 when they had no sitting of it.",
        params: [
          { name: "id", type: "string", required: true, note: "the user's id" },
          { name: "subject", type: SUBJECT_TYPE, required: true },
        ],
        query: [FORM_QUERY],
        returns: "{ ok: true, deleted: number }",
        errors: [
          { status: 400, error: "invalid_subject", when: "subject is not one of the subjects" },
          FORM_ERROR,
          { status: 404, error: "not_found", when: "no such user" },
        ],
      },
      {
        method: "GET",
        path: "/api/diagnostic/reminders",
        summary: "Lists the Slack reminder runs, a page at a time, with whether they are live and who is due.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "assigned is the subjects open on form A, those with enough approved questions; due counts the Participants who have not finished every one of them. sentToday is whether the daily schedule has sent today's.",
        query: listQuery(IRIS_REMINDER_RUN_LIST.sorts, "who ran it, the status, note or error", "desc"),
        returns: `{ runs: { id, trigger: "schedule" | "manual", triggeredBy, triggeredByName, dryRun, status: "running" | "succeeded" | "skipped" | "failed", startedAt, finishedAt, due, messaged, notInSlack, failed, note, error }[], running: boolean, live: boolean, sentToday: boolean, configured: boolean, assigned: subject[], due: number, ${PAGE_FIELDS} }`,
      },
      {
        method: "POST",
        path: "/api/diagnostic/reminders",
        summary: "Reminds every Participant with tests left in Slack now, or with preview logs what it would send.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "A dry run while reminders are not live, or with preview. Unlike the daily schedule, it sends even when today's have already gone out. Each person is sent a direct message with the subjects they have done, started and not started, and a link to their tests; someone with no Slack account for their address is logged as not_in_slack.",
        body: { kind: "json", fields: [{ name: "preview", type: "boolean", note: "Default false." }] },
        returns: "{ ok: true, runId, status: \"succeeded\" | \"skipped\", dryRun, due, messaged, notInSlack, failed, note }",
        errors: [
          { status: 400, error: "invalid", when: "the body has anything but preview" },
          { status: 409, error: "already_running", when: "a run is under way" },
          { status: 409, error: "not_configured", when: "live, and Slack is not connected" },
          { status: 409, error: "missing_scopes", when: "live, and the Slack app cannot send direct messages" },
          { status: 502, error: "slack_error", when: "Slack refused the run; detail says why" },
        ],
      },
      {
        method: "PUT",
        path: "/api/diagnostic/reminders/settings",
        summary: "Puts the Slack reminders live, or back to dry run.",
        access: "assessmentsAdmin",
        token: true,
        notes: "Off by default: until it is live, every run only logs what it would send.",
        body: { kind: "json", fields: [{ name: "live", type: "boolean", required: true }] },
        returns: "{ live: boolean }",
        errors: [{ status: 400, error: "invalid_body", when: "live is not a boolean" }],
      },
      {
        method: "GET",
        path: "/api/diagnostic/reminders/{id}",
        summary: "Returns one reminder run, with a page of whom it messaged, would have, or could not.",
        access: "assessmentsAdmin",
        token: true,
        notes: "detail is the message sent, or in a dry run the one that would be, in Slack's mrkdwn; or why it could not be.",
        params: [{ name: "id", type: "string", required: true, note: "the run's id" }],
        query: listQuery(IRIS_REMINDER_MESSAGE_LIST.sorts, "the name, email or message"),
        returns: `{ run, messages: { id, runId, email, fullName, outcome: "messaged" | "not_in_slack" | "failed", detail, at }[], ${PAGE_FIELDS} }`,
        errors: [{ status: 404, error: "not_found", when: "no run has that id" }],
      },
      {
        method: "GET",
        path: "/api/diagnostic/questions",
        summary: "Lists one subject's questions on one form, with their keys, reviews and live statistics.",
        access: "assessmentsAdmin",
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
        path: "/api/diagnostic/questions/{id}/review",
        summary: "Approves, rejects or returns to draft one question's current version.",
        access: "assessmentsAdmin",
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
        path: "/api/diagnostic/questions/approve-drafts",
        summary: "Approves every draft question on one subject and form at once.",
        access: "assessmentsAdmin",
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
