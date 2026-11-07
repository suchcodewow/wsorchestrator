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
