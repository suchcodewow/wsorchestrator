/** Coach Canary: the coach's profile, the hands-on experiences, the coaching settings, the studio and the map. */

import {
  MIMIR_MESSAGE_MAX,
  MIMIR_SETTING_MAX,
  VIDEO_FEEDBACK_LIMITS,
} from "@/db/schema";
import { EXPERIENCE_REPORT_LIST, SLIDE_FEEDBACK_LIST, MAP_VERSION_LIST, MIMIR_STUDIO_JOB_LIST } from "@/lib/list-specs";
import { EXPERIENCE_IDS, RECENT_SLIDES, WRONG_CLICKS_MAX } from "@/lib/mimir/experiences";
import { SEED_MAX } from "@/lib/mimir/slide-review/generate";
import { MAX_SCORE as SECURITY_MAX } from "@/lib/mimir/security-game/scenario";
import { MAP_SUMMARY_MAX } from "@/lib/mimir/map/schema";
import { DECK_MAX_BYTES, VIDEO_NOTES_MAX } from "@/lib/mimir/studio/shapes";
import { PAGE_FIELDS, listQuery } from "./paging";
import type { EndpointGroup, Field } from "./types";

const EXPERIENCE_TYPE = EXPERIENCE_IDS.map((k) => `"${k}"`).join(" | ");
const EXPERIENCE_PROGRESS_SHAPE = `{ userId, experience: "developer" | "security", attempts: number, bestScore: number | null, firstCompletedAt, lastCompletedAt }`;
const SLIDE_RUN_SHAPE = "{ id, userId, seed: number, theme, found: number, total: number, wrongClicks: number, score: number, createdAt }";
const SLIDE_FEEDBACK_SHAPE = `{ id, seed: number, theme, rating: "up" | "down", comment: string | null, createdAt, user: { name, email } | null }`;
const MESSAGE_SHAPE = `{ seq, role: "user" | "assistant", text, html: string | null, at }`;
const JOB_ID: Field = { name: "id", type: "string", required: true, note: "the job's id" };
const JOB_SHAPE = `{ id, kind: "deck" | "video", status: "uploading" | "queued" | "running" | "ready" | "succeeded" | "failed" | "published" | "discarded", conceptId: string | null, label, input, result: object | null, progress: string | null, error: string | null, requestedBy: string | null, createdAt, startedAt: string | null, finishedAt: string | null, updatedAt }`;
const DIFF_SHAPE = "{ added: { id, name, level }[], removed: { id, name, hadVideo }[], changed: { id, name, was: string | null, what: string[] }[], unchanged: number, slides: { was, now } }";

export const MIMIR_GROUPS: EndpointGroup[] = [
  {
    id: "mimir",
    title: "Coach Canary",
    intro:
      "What you have told the coach about yourself, your runs of the hands-on experiences, and the coaching settings. Everyone's profile and runs are their own; nobody sees anyone else's. Assessments Administrators read the experience report and edit the coaching settings.",
    endpoints: [
      {
        method: "GET",
        path: "/api/mimir/me",
        summary: "Returns what you have told Coach Canary's coach about yourself.",
        access: "signedIn",
        token: true,
        returns: '{ role: "SDR" | "AE" | "SE" | null, coachStyle: "socratic" | "direct", coachPersonality: "canary" | "lasso" | "taylor" }',
      },
      {
        method: "PUT",
        path: "/api/mimir/me",
        summary: "Sets your role, how you like to be coached, and whose voice the coach speaks in.",
        access: "signedIn",
        token: true,
        notes:
          "Kept apart from your Diagnostic track. Coach Canary's chat uses it from its next reply. Leaving coachPersonality out keeps it as it was. The personality changes only the coach's voice, not how it marks you.",
        body: {
          kind: "json",
          fields: [
            { name: "role", type: '"SDR" | "AE" | "SE" | null', required: true },
            { name: "coachStyle", type: '"socratic" | "direct"', required: true },
            { name: "coachPersonality", type: '"canary" | "lasso" | "taylor"', required: false },
          ],
        },
        returns: "{ ok: true, role, coachStyle, coachPersonality? }",
        errors: [{ status: 400, error: "invalid", when: "the body does not parse" }],
      },
      {
        method: "GET",
        path: "/api/mimir/experiences",
        summary: "Returns your finished runs of the hands-on experiences: the Developer and Enterprise Security Team experiences, and your latest slides of the slide review.",
        access: "signedIn",
        token: true,
        notes: "An experience you have never finished has no row in progress. bestScore is null for the Developer experience, which keeps only that it was finished. slides is your latest 100 slides of the slide review, newest first; a slide's seed rebuilds it exactly.",
        returns: `{ progress: ${EXPERIENCE_PROGRESS_SHAPE}[], slides: ${SLIDE_RUN_SHAPE}[] }`,
      },
      {
        method: "POST",
        path: "/api/mimir/experiences",
        summary: "Records one finished run of a hands-on experience, or one finished slide of the slide review.",
        access: "signedIn",
        token: true,
        notes: `The experiences run in the browser and send this when a run ends. developer takes nothing more, and adds an attempt. security takes its run's total as score, 0 to ${SECURITY_MAX}, and keeps the best. slide-review takes the slide's seed, how many of its mistakes were found and how many wrong clicks there were; the server rebuilds the slide from the seed for its theme and its number of mistakes, and works out the score itself, so found can't be more than the slide had. Each slide-review call adds a slide, even for a seed played before.`,
        body: {
          kind: "json",
          fields: [
            { name: "experience", type: EXPERIENCE_TYPE, required: true },
            { name: "score", type: "integer", note: "security only" },
            { name: "seed", type: "integer", note: `slide-review only: 1 to ${SEED_MAX}` },
            { name: "found", type: "integer", note: "slide-review only: 0 to the slide's number of mistakes" },
            { name: "wrongClicks", type: "integer", note: `slide-review only: 0 to ${WRONG_CLICKS_MAX}` },
          ],
        },
        returns: `{ progress: ${EXPERIENCE_PROGRESS_SHAPE} } for developer and security; { slide: ${SLIDE_RUN_SHAPE} } for slide-review`,
        errors: [{ status: 400, error: "invalid", when: "the body is not a run that experience can report" }],
      },
      {
        method: "GET",
        path: "/api/mimir/experiences/report",
        summary: "Lists everyone with an account, with their concept videos watched to the end, the concepts the coach has marked them as knowing, and their hands-on experiences, a page at a time.",
        access: "assessmentsAdmin",
        token: true,
        notes: `videos counts concept videos watched to the end, and mastered the concepts the coach in Chat has marked as known. developerCompletedAt is when they first finished the Developer experience, or null. securityAttempts and securityBest are their finished runs of the Enterprise Security Team and the best total of them. slidesDone is how many slides of the slide review they have finished, slidesScore their points on all of them, and slidesFound and slidesTotal the mistakes they found out of how many there were. recentSlides is their latest ${RECENT_SLIDES} slides, newest first, each with the seed that rebuilds it. Sorting by security sorts by securityBest, by developer by developerCompletedAt, and by slides by slidesDone.`,
        query: listQuery(EXPERIENCE_REPORT_LIST.sorts, "the person's name or email"),
        returns: `{ people: { userId, name, email, videos: number, mastered: number, developerCompletedAt: string | null, securityAttempts: number, securityBest: number | null, slidesDone: number, slidesScore: number, slidesFound: number, slidesTotal: number, recentSlides: { seed: number, theme, found: number, total: number, wrongClicks: number, score: number, at }[] }[], ${PAGE_FIELDS} }`,
      },
      {
        method: "GET",
        path: "/api/mimir/slide-feedback",
        summary: "Lists the smiley and confused ratings given to slide review slides, with any comment, a page at a time, the newest first.",
        access: "assessmentsAdmin",
        token: true,
        notes: "seed rebuilds the slide the rating was about, exactly as it was dealt; theme is the theme that seed makes. user is null once the account that gave it is deleted.",
        query: listQuery(SLIDE_FEEDBACK_LIST.sorts, "the comment, or the name or email of who gave it", "desc"),
        returns: `{ feedback: ${SLIDE_FEEDBACK_SHAPE}[], ${PAGE_FIELDS} }`,
      },
      {
        method: "POST",
        path: "/api/mimir/slide-feedback",
        summary: "Rates a slide review slide with a smiley or confused face, with a comment if you like.",
        access: "signedIn",
        token: true,
        notes: "The slide is named by its seed. Rating the same slide again adds another rating; nothing is replaced.",
        body: {
          kind: "json",
          fields: [
            { name: "seed", type: "integer", required: true, note: `1 to ${SEED_MAX}` },
            { name: "rating", type: `"up" | "down"`, required: true, note: "up is the smiley face, down the confused one" },
            { name: "comment", type: "string", note: `up to ${VIDEO_FEEDBACK_LIMITS.comment} characters, trimmed; blank is no comment` },
          ],
        },
        returns: `{ feedback: ${SLIDE_FEEDBACK_SHAPE} }`,
        errors: [{ status: 400, error: "invalid", when: "the seed, rating or comment is not one of those above" }],
      },
      {
        method: "GET",
        path: "/api/mimir/settings",
        summary: "Returns the coaching settings every prompt carries.",
        access: "assessmentsAdmin",
        token: true,
        notes: "Each is its default until someone saves it; updatedAt and updatedBy are null until then.",
        returns: "{ platformContext, namingGuard, updatedAt, updatedBy }",
      },
      {
        method: "PUT",
        path: "/api/mimir/settings",
        summary: "Saves the coaching settings.",
        access: "assessmentsAdmin",
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
    title: "Coach Canary Studio",
    intro:
      "Making the Coach Canary map and its videos with Claude. A new slide deck is read into a draft of the map, which is checked against the live one and then published or thrown away; a concept's video is written, narrated and rendered by the explainer standards, taking in the accepted comments on the video before it. Each runs as a job on the mimir-studio Cloud Run job, which reports its progress on the job's row; at most one deck is under way at a time, and one video per concept. A job that stops reporting for four hours is marked failed.",
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
        summary: "Has Claude make a concept's video afresh, or its first, in every language; or only the translations it lacks.",
        access: "mimirStudio",
        token: true,
        notes: `The job is given every accepted comment on the concept's video (up to ${VIDEO_NOTES_MAX}), each as where in the video it was made, the rating and the words, and writes the script and scenes by the explainer standards, starting from what the last video was made from. When it succeeds the concept's video is the new one, under a new name, so a page still playing the old one is not cut off, and those comments are marked applied. Its translations come off then, so nobody watches one of the old video, and are made again by the same job: until each is done that language plays in English, and if one fails the job is failed with the English video left up. translationsOnly leaves the English video and any comments alone. started is false when the studio could not be started; the job is then failed, with why.`,
        params: [{ name: "id", type: "string", required: true, note: "the concept's id" }],
        body: {
          kind: "json",
          fields: [{ name: "translationsOnly", type: "boolean", note: "only make the translations this video lacks; a body is optional" }],
        },
        returns: `{ job: ${JOB_SHAPE}, started: boolean }, with 201`,
        errors: [
          { status: 404, error: "not_found", when: "no concept on the map has that id" },
          { status: 409, error: "busy", when: "a video for this concept is already under way" },
          { status: 409, error: "nothing_to_translate", when: "translationsOnly, and the concept has no video or lacks no translation" },
          { status: 503, error: "not_configured", when: "this deployment has no bucket or no studio job" },
        ],
      },
      {
        method: "GET",
        path: "/api/mimir/studio/jobs",
        summary: "Lists Coach Canary Studio's jobs, decks and videos, a page at a time, the newest first.",
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
        summary: "Returns one Coach Canary Studio job and, for a deck ready to publish, what publishing it would change.",
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
    title: "Coach Canary map",
    intro:
      "The concept map, the video for each concept, and the coach that walks you through them in order. Anyone signed in reads the map, watches the videos and chats with the coach, and keeps their own progress; nobody sees anyone else's. A Assessments Administrator imports the map.",
    endpoints: [
      {
        method: "GET",
        path: "/api/mimir/map",
        summary: "Returns the concept map and where you stand on every concept in it.",
        access: "signedIn",
        token: true,
        notes:
          "map is null until a Assessments Administrator imports one. A concept's video holds only its length: where the file is kept and what the narrator says stay on the server. states has an entry for each concept you have progress on: resumeAt is where playing starts if you press play now (the beginning if you had reached the end), completed is kept once you have watched to the end, recommended is the coach asking you to watch the video before you move on, and points is your checklist for the concept as stored: the one the coach set out for you, or your ticks against the concept's own points. videos is false on a deployment with nowhere to keep them.",
        returns:
          "{ map: { version, title, lead, sections, slides, levels, buckets, concepts: { id, name, slides, explanation, points?: string[], video?: { seconds } }[] } | null, importedAt: string | null, states: { [conceptId]: { videoSeconds, videoFurthest, videoDuration, completed, mastered, recommended, points: { text, covered }[] | null, resumeAt } }, videos: boolean }",
      },
      {
        method: "POST",
        path: "/api/mimir/map/import",
        summary: "Imports the concept map from a JSON file, as a new version that replaces the one there.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "The file is validated whole and written whole, or refused. It is the whole map, videos and all: each concept in it gets the videos the file gives it, or none. Progress is keyed by concept id, so everyone's progress on a concept the new map keeps carries over. frontend/scripts/mimir-map-convert.ts makes such a file from the course data and the videos' scripts. The content is private, so the file is never committed.",
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
        path: "/api/mimir/map/versions",
        summary: "Lists every version of the concept map, a page at a time, the newest first.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "Each import, published deck, edit and restore adds a version, and the highest is the live map (live: true). source says which made it; summary is what it said it changed, and is what q searches. createdBy is null for the version made when versions began, and for an account since deleted.",
        query: listQuery(MAP_VERSION_LIST.sorts, "what the version said it changed", "desc"),
        returns: `{ versions: { version, source: "import" | "deck" | "edit" | "restore" | "migration", summary, createdAt, createdBy: { id, name, email } | null, live: boolean }[], ${PAGE_FIELDS} }`,
      },
      {
        method: "GET",
        path: "/api/mimir/map/versions/{version}",
        summary: "Returns one version of the concept map's structure.",
        access: "assessmentsAdmin",
        token: true,
        notes: "The structure only: sections, slides, levels, groups and concepts, without videos, which are kept apart and belong to each concept whichever version is live. Send it back, changed, as the content of a new version.",
        params: [{ name: "version", type: "number", required: true, note: "the version's number" }],
        returns: "{ version, source, createdAt, content: { version, title, sections, slides, levels, buckets, concepts } }",
        errors: [{ status: 404, error: "not_found", when: "there is no such version, or it no longer fits the map's shape" }],
      },
      {
        method: "POST",
        path: "/api/mimir/map/versions",
        summary: "Changes the live concept map, as a new version: an edit to its structure, or an earlier version put back.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "base is the version the change was made from. It must still be the live one: if another version has been added since, nothing changes and the answer is 409 with the live version, so a change is never made over one you did not see. Send content and summary to edit, or restore to put an earlier version back. content is validated whole, as an import is. Any videos in it are ignored: each concept keeps the videos it has, and one taken off the map has its video again if it comes back.",
        body: {
          kind: "json",
          fields: [
            { name: "base", type: "number", required: true, note: "the live version, as you read it" },
            { name: "content", type: "object", note: "the whole map, as GET /api/mimir/map/versions/{version} returns it, changed" },
            { name: "summary", type: "string", note: `what you changed, up to ${MAP_SUMMARY_MAX} characters; required with content` },
            { name: "restore", type: "number", note: "an earlier version to put back, instead of content" },
          ],
        },
        returns: "201 { version }",
        errors: [
          { status: 400, error: "invalid_body", when: "base is missing, or there is neither content with a summary nor restore" },
          { status: 400, error: "invalid", when: "content does not fit the map's shape; path and message say where" },
          { status: 404, error: "not_found", when: "restore names no version that still fits the map's shape" },
          { status: 409, error: "conflict", when: "base is not the live version; live is the one that is" },
        ],
      },
      {
        method: "GET",
        path: "/api/mimir/map/concepts/{id}/video",
        summary: "Returns a link to play a concept's video, and where to start.",
        access: "signedIn",
        token: true,
        notes:
          "url is a signed Cloud Storage link, good for expiresInSeconds, that the browser plays directly, so seeking works. startAt is where you left off, or 0 if you had reached the end or have not started; a place kept in another language carries over as a share of the video's length. It plays in language, or else the language you last chose, or English if the video is not in that yet: language in the answer is the one you got, languages all it can be watched in, and object the file, to send with any feedback.",
        params: [{ name: "id", type: "string", required: true, note: "the concept's id" }],
        query: [
          { name: "language", type: `"en" | "es"`, note: "the language to play it in" },
          { name: "version", type: "string", note: "play this file of the video instead, by the videoObject on a piece of feedback" },
        ],
        returns: `{ url, expiresInSeconds, name, seconds, startAt, state, language: "en" | "es", languages: ("en" | "es")[], object }`,
        errors: [
          { status: 404, error: "not_found", when: "no concept has that id, it has no video, or version is not a file of it" },
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
        summary: "Returns your conversation with the Coach Canary coach and how far through the course you are.",
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
        summary: "Sends the coach a message, or asks it to greet you or introduce your coach style, and returns its reply.",
        access: "signedIn",
        token: true,
        notes:
          "Send { message } to say something, { open: true } to have the coach greet you, say where you are and ask about the next concept, or { introduce: true } to have it introduce itself in the coach style you last set with PUT /api/mimir/me and carry on where you were. The coach checks what you know of each concept in turn, against a checklist of its main points: the concept's own, or one it sets out the first time it asks. It ticks each point once you have put it in your own words, in whichever message, and the ticks are kept. When every point is ticked the concept is mastered and it moves on; when you do not know the concept it links its video and marks it recommended. mastered and recommended list the concept ids it changed; covered lists, per concept, the points this reply ticked and how many of its checklist are now covered. The coach is Claude Sonnet 5.5; a request it declines is answered by Anthropic's fallback model, and when it can't be reached, by Claude Haiku 4.5. Send Accept: text/event-stream to have the reply streamed as it is written — text events with each delta, restart if it begins again on the fallback model, then done with the body below, or error with { error, status } — otherwise the whole reply comes back as JSON.",
        body: {
          kind: "json",
          fields: [
            { name: "message", type: "string", note: `up to ${MIMIR_MESSAGE_MAX} characters; give this, open or introduce` },
            { name: "focus", type: "string", note: "optional, with message: a concept id; the coach turns to that concept now, ahead of the course order, as the map's chat button asks it to. An id not in the course is ignored" },
            { name: "open", type: "true", note: "ask the coach to greet you instead of saying something" },
            { name: "introduce", type: "true", note: "ask the coach to introduce itself in your coach style instead of saying something" },
          ],
        },
        returns: `{ messages: ${MESSAGE_SHAPE}[] (yours, if you said something, and the coach's), progress, mastered: string[], recommended: string[], covered: { id, points: string[], covered: number, total: number }[] }`,
        errors: [
          { status: 400, error: "invalid", when: "none of message, open or introduce is given, or the message is empty or too long" },
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
