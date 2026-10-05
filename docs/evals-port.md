# Porting the eVals Google Sheet

Bootcamp and intermediate used to run from a Google Sheet with an Apps Script
project bound to it (clasp project `1zEaBVh9MmZqF6Wa6uw0W77ts700RVDZm-5h52c8sTDlr9f61vx_Mp6yH`;
the source is `Code.js`, `hibob.js`, `exercises.js`, `slack.js`,
`flightdeck.js`, `bq.js` and the HTML dialogs). This page lists every feature
that tool has and where each stands in harnessevents.

**Decision** is for the team to fill in as we go through the list:
*implement*, *drop* (not needed, so don't port it), or *done*. When a feature
is ported or dropped, update its row in the same PR.

Status means:

- **Ported**: harnessevents does the job, though perhaps differently. The
  difference is noted.
- **Partial**: some of it is there. What's missing is noted.
- **Not ported**: only the Sheet does it.

## Roster: who should attend

| Feature | What the Sheet does | Status in harnessevents | Decision |
| --- | --- | --- | --- |
| Daily HiBob sync | `getHiBobEmployees` runs at 8 AM and rebuilds the Employees and Candidates tabs | **Ported.** Cloud Scheduler runs it at 3 AM ET. Each run is logged, and Cohort Settings → HiBob has a button to run it now | |
| Organization under a leader | Walks each person's `reportsTo` chain up to a hard-coded leader | **Ported.** The leader is a setting on Cohort Settings → Automation. Only how far each person sits below the leader is stored, not the chain itself | |
| Start date and active effective date cutoffs | Candidates must be hired on or after 2025-04-01, and have an active effective date after 2026-01-01. Both dates are hard-coded | **Ported.** Two settings on Cohort Settings → Automation, defaulting to the Sheet's dates; blank turns a cutoff off | |
| Bootcamp vs. intermediate | No BTC date means bootcamp; a BTC date and no INT date means intermediate | **Ported.** On Cohorts → Current, one table; a BTC date marks an intermediate candidate, and the Bootcamp and Intermediate counters filter by stage | |
| Sales or Engineer role from the title | Config tab's "Automatic Sales Titles" and "Automatic Engineer Titles" set the Role column | **Ported.** Title lists on Cohort Settings → Automation. A title on no list shows as Undecided, where the Sheet left Role blank | |
| Ignored titles | "Ignore this Title" adds the selected row's title to the list and deletes everyone with that title from the attendee tabs | **Ported, differently.** Titles go on the Ignored list on Cohort Settings → Automation, and anyone holding one is re-tracked at once. Picking Sales, Engineer or Ignored in the Current tab's Track column also puts that person's title on the list, moving it off another list if need be, and re-tracks everyone who holds it; anyone set by hand keeps their track | |
| Bootcamp history | An external Bootcamp_History sheet holds BTC/INT dates, scores and per-form scores. Its dates decide each person's stage | **Ported.** eVals → Bootcamp History lists everyone by name, email and bootcamp date, newest first, and can narrow to the active (still in the employee list) or the inactive; each person's page shows their whole row. Any eVals Viewer can see both. Cohorts → Previous lists the same history by session: each BTC/INT date with its head counts, opening to who attended bootcamp and who attended intermediate that day, for any Training Viewer. History is read-only in the app: a bootcamp writes its scores at the end of a session (see *Writing final scores to history*), and nobody edits them afterwards. Production holds all 303 rows of `Bootcamp_History.xlsx`, loaded by script on 2026-10-03 | done |
| Exempt (1/1/2000 dates) | A sentinel BTC or INT date of 2000-01-01 means "never needs this" | **Ported, broader.** A sentinel date on either BTC or INT exempts the person from both stages, not just the one it's on | |
| Remove from INT tracking | Menu item that sets the selected person's INT date to the sentinel and removes their row | **Not ported** | |
| Deferred | Someone who started within 14 days of the event start is marked Deferred, sorted last and left out of the Slack messages | **Ported.** The window is a setting on Cohort Settings → Automation, 14 days until changed, 0 for off. Anyone whose HiBob start date is fewer than that many days before the next bootcamp (the active one, else the soonest scheduled), or after it, is on the Deferred track; a blank start date never is. An ignored title, exempt history or a track an administrator set by hand comes first; the Sales and Engineer lists come after. The sync, a change to the window and any bootcamp change all re-track. They are listed on Cohorts → Deferred, by stage, rather than on the Current tab, so they are never mixed in with those still to train. Leaving them out of the Slack messages waits for the Slack message builder | done |
| Roster frozen once the event starts | The daily sync skips itself from the Event Start Date onward, so the attendee list stops changing | **Not ported.** The Current tab is recomputed from every sync | |
| Roster kept per event | The attendee tabs only ever add people; nobody drops off mid-event | **Not ported.** There's no stored attendee list per bootcamp | |
| Management chain on each attendee | Every manager's email up to the leader, plus the Config tab's "Add these email to any slack" addresses | **Ported, stored apart.** Each sync stores `employees.management_chain`: every manager's email from the direct one up to the leader, joined with `;` as the Sheet did. `GET /api/evals/organization` returns it, but no page shows it yet. The extra addresses are eVals settings → Additional Slack Contacts, kept out of the chain; the Slack messages add them when they are sent | done |

## Running an event

| Feature | What the Sheet does | Status in harnessevents | Decision |
| --- | --- | --- | --- |
| New event setup | "New Event Setup" asks for the start date, rebuilds the attendee tabs, deletes old responses and installs the trigger | **Partial.** The Scheduler creates bootcamps with a start date, BTC days and INT days, and one is active. Nothing is reset or rebuilt when a new one starts | |
| Schedule tab formatting | Conditional formatting on the Schedule tab, color-coded for BTC, INT, SE and a fourth track | **Ported.** Opening a bootcamp in the Scheduler shows its schedule: Bootcamp, Intermediate, SE Bootcamp and SE Intermediate, each day from 8 AM in quarter hours. A session is dragged to any time of the day, to another track, or in the One track view to another day; what it lands on is pushed later. It is dragged at the bottom edge to change length. Time with nothing in it shows as Unscheduled with how long it is, and can be clicked to add a session there; each column says how much of the day to 5 PM is unscheduled or over. A session is Main (one leader, other instructors, one room), Breakout (a room per instructor) or Unstructured (no one, no room), with its own name, description, icon, color and comments. Leaders and instructors are the training administrators and the bootcamp's guest judges; rooms come from the facility picked for the bootcamp (Scheduler settings → Facilities). A person or room booked twice at once across the four tracks is shown in red with the reason, and the server refuses to add one that is already busy. Session types (Scheduler settings → Session types) are starting points only. A new bootcamp can copy an earlier one's schedule; importing the Sheet's Schedule tab was dropped, as the Sheet is being retired | done |
| Visual Schedule | Builds a card-style day-by-day view from the Schedule tab | **Ported.** The schedule page has a detailed view like the Sheet, a condensed view of names only, and a One track view that lays one track's days side by side | done |
| Exercises deck and judge assignment | `buildExercises` makes a Slides deck (one slide per exercise) in the Enablement shared drive and spreads attendees evenly across judges. It writes back the deck link and the time each exercise needs | **Partial.** Training administrators pick a bootcamp's guest judges from the employee list in the Scheduler's bootcamp dialog. While that bootcamp is active a judge can score on the eVals page, whatever other access they have. There is no deck, and attendees are not spread across judges | |

## Judging and scores

| Feature | What the Sheet does | Status in harnessevents | Decision |
| --- | --- | --- | --- |
| Eval forms and criteria | The BTC-Evals and INT-Evals tabs define forms and their criteria, each for Sales, Engineer or All | **Ported** as assessments. eVals Settings → Assessments, for eVals administrators, defines each one's name, session (Bootcamp or Intermediate), group (sales, engineer or both), whether it is active, and any number of criteria with descriptions. Criteria are rows, so a new one adds no column. Once anyone is scored, the session and group are fixed, a removed criterion is retired rather than deleted, and the assessment cannot be removed, only made inactive | done |
| Scoring web app | A judge picks an attendee and a form, scores each criterion 1 (Poor) to 4 (GOAT) with feedback, and adds positive and constructive comments. Reopening an attendee loads the latest submission, from any judge, to revise | **Ported.** eVals has Bootcamp and Intermediate tabs listing their active assessments; each lists the current candidates on its tracks (never undecided or deferred), and each attendee opens a form scoring every criterion 1–4 with an optional comment. The average shows rounded to a whole number: 1–2 requires constructive feedback, 4 requires positive. It is stored to one decimal. There is one submission per attendee per assessment per bootcamp; anyone may revise it, the form says who wrote it if it was someone else, and whoever saves last owns it. eVals Viewers and above, and the active bootcamp's guest judges, can score; nobody can without an active bootcamp, and an intermediate assessment needs one with INT days | done |
| Responses and per-form scores | Each submission is saved to a "Responses - form" tab, and its scores and comments are copied onto the attendee's row | **Ported.** A submission and each criterion's score and comment are rows, keeping the names they were scored under; an attendee scored before a criterion was added shows as needing rescoring | done |
| Final scores | Averages every form's score, plus a 4-point score derived from the entrance and exit exam average (≥96% → 4, ≥88% → 3, ≥80% → 2, else 1) | **Not ported** | |
| AI comment summaries | Claude condenses each attendee's positive and constructive comments into 25 words or fewer, in batches, resuming where it left off if it runs out of time | **Not ported** | |
| Writing final scores to history | Writes BTC/INT score, date and per-form scores back to Bootcamp_History | **Not ported.** The Current tab has the buttons, disabled until judging exists | |
| Entrance and exit exams | Exam percentages are entered on the attendee tabs | **Not ported** | |

## Communication and integrations

| Feature | What the Sheet does | Status in harnessevents | Decision |
| --- | --- | --- | --- |
| Slack message builder | Fills the Feedback tab's template with each attendee's values and score lines; a 4 adds the positive comment, a 1–2 the constructive one. Copies the message and the management chain to paste into Slack | **Not ported.** When it is, each team's message goes to the management chain plus the Additional Slack Contacts | |
| Slack channel creation | Creates or finds a private channel, invites attendees by email and makes some of them channel managers | **Not ported.** The script's function was never wired to a menu | |
| Mindtickle assessments | Signs in to Mindtickle, looks up users and lists the Config tab's assessment series | **Not ported.** It only logged results; it was never finished | |
| BigQuery | Upserts rows into `sales-209522.enablement.events` by email | **Not ported.** Only test functions called it | |
| HiBob code maps | Static department and title code maps (`hibob_mapping.js`) | **Not needed.** The sync asks HiBob for readable labels | |

## Only in harnessevents

These have no counterpart in the Sheet:

- A log of every HiBob sync, and a lock so only one runs at a time.
- HiBob's full record for each employee.
- The Organization Leader as a setting rather than code.
- Cohort Settings' Employees and Organization tabs.
- Title lists with bulk paste, and a list of the org's titles on no list.
- Stage and track counters on the Current tab that filter its one table.
- A track set by hand: an administrator can put anyone on any track from the Current tab, and it holds through every sync until handed back to the rules.
- Bootcamp scheduling.
- A schedule builder that catches a person or room booked twice across the four tracks.
- Roles that decide who can see and change each page.
- An audit record of every change.
- Paging on every table, and an API with personal access tokens.

## Before retiring the Sheet

The Sheet's script has four credentials written into its source:

- an Anthropic API key
- the HiBob service-user token
- a Mindtickle API key and secret
- a Slack bot token

Anyone who can edit the Apps Script project can read them. Rotate them when the Sheet is retired, and sooner if the HiBob service user is the one harnessevents uses.
