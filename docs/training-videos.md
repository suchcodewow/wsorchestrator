# Training videos

Narrated walkthroughs of Harness Events, one per persona and job, made with the
explainer engine against a demo deployment with nobody real in it. How one is
made is in [scripts/explainer-video/TRAINING.md](../scripts/explainer-video/TRAINING.md).
The videos themselves, their scripts and their captures are local, like the
explainers (`scripts/explainer-video/.gitignore`).

A persona is what someone can reach, not a job title: the roles in
[README.md](../README.md#site-roles) (one per area: events, training, assessments),
the platform flag, and three things that are granted without being roles: guest
judging, being a people manager in HiBob, and being a Diagnostic Participant.
Someone can be several personas at once, and each video assumes only its own.

Status: **made** has an MP4, transcript and captions; **next** is the likeliest
to be made next; the rest are proposed.

## Everyone who signs in

| Persona | What they reach | Videos |
| --- | --- | --- |
| **Any employee** | Welcome, Coach Canary, Reporting → Bootcamp (their own reports), My inbox, My settings, the Training Recorder (`/record`) | Finding your way around: Welcome and the sidebar · Learning with Coach Canary: the library and the coach · Recording yourself with the Training Recorder · My settings: theme, API tokens, Check my PC |
| **Guest judge** (granted per bootcamp in the Scheduler) | The active bootcamp's schedule; scoring in eVals | **Made:** The bootcamp schedule: All Tracks, One Track, Me (`guest-judge-schedule`, 1:27) · **Made:** Scoring an assessment in eVals (`guest-judge-evals`) · **Next:** Recording and transcribing while you score, and AI comments · Participation marks · Tagging someone in a comment, and My inbox |
| **People manager** (anyone with reports in HiBob) | Reporting → Bootcamp for their org; Canary Wire | Reading your team's bootcamp results · Following up with Canary Wire |
| **Diagnostic Participant** | Diagnostic | Taking the Diagnostic: what to expect, and finishing a subject |

## Events

| Persona | What they reach | Videos |
| --- | --- | --- |
| **Event Contributor** | Harness components | Writing a Harness component |
| **Event Operator** | Orchestrator, Event Guides | Scheduling a workshop · Watching a run, and reading why one failed · Giving attendees their accounts and the lab guide · Tearing a workshop down |
| **Event Manager** | Also everyone's events; workshops and lab guides | Show all events, and managing someone else's · Writing a lab guide |
| **Event Administrator** (area admin) | Event Settings, Cloud Status, event roles | Event Settings: org secrets, templates, GitHub repositories · Cloud Status: what each cloud holds, and what's left behind · Giving someone an event role |

## Training

| Persona | What they reach | Videos |
| --- | --- | --- |
| **Training Viewer** | Scheduler (every bootcamp), Cohorts, Logistics, Async Recordings, Survey Results | Reading a bootcamp's cohort · Logistics: guest judges, dietary needs, food orders · Reading the daily survey results |
| **Training Administrator** (area admin) | Also Scheduler, Cohort, Logistics settings; training roles | Building a bootcamp schedule: sessions, drag and drop, issues · Breakouts: instructors, rooms and groups · Adding guest judges · Day checklists · Facilities, rooms and session types · Cohort Settings: employees, HiBob, titles, Slack channels · Making a bootcamp active, and what that changes · Giving someone a training role |

## Assessments

| Persona | What they reach | Videos |
| --- | --- | --- |
| **Assessments Viewer** | eVals, read-only; Reporting for everyone; Canary Wire | Reading scores in eVals · Reporting → Bootcamp across every team |
| **Assessments Administrator** (area admin) | Also scoring, eVals settings, Reporting Settings, Coach Canary Settings (Mimir Studio), Diagnostic Settings; assessments roles | Building an assessment and its criteria · Google Meetings and Slack contacts · Correcting a score · Releasing a class's scores to managers · Coach Canary Settings: the map, feedback, and regenerating a video in Mimir Studio · Diagnostic Settings: Participants, auto-enroll, the answer key, approving questions |

## Platform

| Persona | What they reach | Videos |
| --- | --- | --- |
| **Platform administrator** | Every area as its administrator; Manage users, Backups, Admin Settings, Audit Trail | Manage users: adding someone, roles in every area, invitations, deleting · Viewing the app as someone else, and test accounts · Admin Settings: sign-in domains, framing sites, Google, Zoom and Slack connections, timed jobs · Backups: making one and restoring · Reading the Audit Trail · The cohort test group |

## What each new persona needs

- **A seed script** in `scripts/explainer-video/training/`, like
  `demo-guest-judge.sql`: the persona's account and session token, and the data
  their video shows. Administrator videos that change things (a role, a
  setting, a restore) change only the demo database.
- **Nothing that leaves the machine.** Videos for Slack syncs, Google Meetings,
  HiBob, Zoom or a workshop run would call real services. The demo app has
  none of their keys, so those videos show the pages and stop before the
  action, or need a stub for that service first.
- **A Diagnostic Participant** needs their own seed, because the anonymize
  script deletes every Participant and attempt.

## What the first two videos taught

Found while making `guest-judge-schedule` and `guest-judge-evals`, and worth
knowing before the next one:

- **Look before you write the steps.** Drive the page once as the persona
  (Playwright, a screenshot after each click) and write the shot list from
  what it shows. Most steps that failed were guesses about the page.
- **A control can be clickable without Playwright agreeing.** Schedule cards
  are `role="button"` divs that dnd-kit marks `aria-disabled` for anyone who
  can't drag, so `locator.click()` refuses them, yet a judge's real click opens
  the session. `cli/capture.ts` clicks with the mouse at the target's centre
  for this reason. Target the cards by their `title`, which starts with the
  session's name (and its emoji, so use `title*=`).
- **Labels aren't always where the source says.** `MentionTextarea` takes an
  `aria-label` that doesn't reach its `<textarea>`; target it by its section,
  `section:has(h3:has-text("…")) textarea`. Accessible names match as
  substrings: `role=radio[name="Bootcamp"]` also matches "SE Bootcamp"; add
  `s` for an exact match.
- **Narrate what the app does, not what you expect.** Submit in eVals returns
  to the full attendee list, not Assigned to me. A guest judge can open a
  session card even though it looks read-only.
- **Hide what only a dev server shows.** The capture hides the environment
  badge (`span[title$="not production"]`) and Next's indicator
  (`nextjs-portal`) with CSS rather than changing the app.
- **Long typing has to fit before the next step.** `Screen.tsx` speeds a typed
  comment up so it finishes before the next step's cursor moves; a long
  comment under a short sentence otherwise overlapped the next click.
- **Steps that write change the demo.** Submitting a score leaves a submission
  behind, and the next capture opens a form already filled in. Undo it first
  (the seed or a one-line delete), or the video changes.
- **Building the demo database:** `TRUNCATE … CASCADE` on `users` would also
  empty bootcamps and the schedule, because many tables point at `users`.
  `demo-anonymize.sql` deletes instead, which respects each foreign key's
  `ON DELETE`. Some names that look like tables are views (`hibob_employees`).
- **Cost of the two videos:** about 80 seconds of narration each, a few
  minutes to capture, and about five minutes each to render on a Mac.

## Making them from Mimir Studio (not built)

Discussed in November 2026 and set aside for now: a **Tutorials** tab in Admin
Settings (platform administrators) where someone writes a prompt, picks a
persona, and gets a download link for the MP4, transcript and captions when
the job finishes. It is viable; this is how it would fit and where it is hard.

**What already fits:**

- **The job.** A tutorial is a third kind of `mimir_studio_jobs` row beside
  `deck` and `video`. The app queues it and starts `mimir-studio` with its id
  (`frontend/src/lib/mimir/studio/trigger.ts`). The job's limits (three hours,
  8 CPUs, 16 GiB, `infra/admin/studio.tf`) are enough. The image already has
  Chromium, ffmpeg and Remotion; add `playwright-core`, which drives the same
  Chromium (`CHROME_PATH`) and downloads nothing.
- **Writing the video.** The agent loop in `studio/video.ts` with tools for this
  kind of video. Claude reads the prompt and explores the demo as the persona
  (screenshot plus accessibility tree). It writes `content/` and the shot list,
  then captures, narrates, renders stills and looks at them, renders, and
  inspects. `finish` refuses until all of that has been done since the last
  change, as it does for explainers.
- **The tab and the download.** Admin Settings' tabs are in
  `frontend/src/app/(app)/admin-settings/tabs.ts`. The job writes the files
  under `mimir/` in the recordings bucket; a route streams them, as
  `api/mimir/map/concepts/[id]/video` serves a concept's video.

**The hard part: an app to film.** The job can't film the deployed app.
Production and QA both show real people, and a tutorial's clicks (Submit,
saving a setting) would change real data. Each run needs a private app:

- **An app server inside the job.** The frontend builds as a standalone server
  (`output: "standalone"` in `next.config.ts`). The image copies that build in
  and starts it on localhost, with an `.env` holding only the demo database and
  auth values. It gets no Slack, HiBob, Zoom, Harness or Deepgram keys.
- **A demo database, stored in the bucket, never in git.** Anonymized data
  still holds real session names and assessment criteria, and the repo is
  public. A person makes a dump with `demo-anonymize.sql` and uploads it. Each
  run restores it into a throwaway database, applies the current migrations and
  runs the persona's seed. Each environment makes its own dump from its own
  data; never copy one environment's data into another (CLAUDE.md, "QA is not
  a sandbox either").
- **Personas, not free text.** The form picks a persona, which names a seed
  script and a session token in the demo. The video then shows only what that
  persona can do.

**What the repo's rules add:**

- **Database:** a migration adding `tutorial` to
  `mimir_studio_jobs_kind_check`. `mimir_studio_jobs_concept_check` ties
  `concept_id` to `deck` and needs rewriting.
- **API:** routes to list, create, read progress and download, each through
  `requireCaller` and `audited`, with `/api` reference entries and e2e matrix
  rows.
- **The list of prompts:** a `ListSpec` with 100-row paging.
- **Infra:** Terraform for the bigger image and the bucket layout.

**Risk:** the agent writing working steps unattended. Every lesson above was a
retry while making two videos by hand. The explore tool and capture errors that
name the failing selector and page are what make it workable; some prompts
will still fail and need rewording.

**Order to build it in,** each checkable locally before the next: the demo
dump and its restore, then the job kind and its tools (run with
`npm run job -- <id>`), then the tab and the download.
