# Training videos

Narrated walkthroughs of Harness Events itself: the real app on screen, a drawn
cursor that moves, clicks and types on the spoken word, and a transcript and
captions beside the MP4. They use the explainer engine (`README.md`): the same
narration, timing, rendering and checks. Only the pictures differ. A training
video shows screenshots of the app where an explainer shows motion graphics.
Which videos exist, and for whom, is in [docs/training-videos.md](../../docs/training-videos.md).

## How one is made

1. **A demo of the app with nobody real in it.** Copy local `workshops` into
   `workshops_demo`, make everyone in it up, and seed the persona's data:

   ```bash
   docker exec workshoporchestrator-postgres-1 sh -c 'createdb -U postgres workshops_demo && pg_dump -U postgres --no-owner workshops | psql -q -U postgres -d workshops_demo'
   docker exec -i workshoporchestrator-postgres-1 psql -q -U postgres -d workshops_demo < training/demo-anonymize.sql
   docker exec -i workshoporchestrator-postgres-1 psql -q -U postgres -d workshops_demo < training/demo-guest-judge.sql
   ```

   `demo-anonymize.sql` deletes what names or quotes people (audit records,
   submissions, transcripts, Slack, HiBob, comments, every account) and gives
   everyone else a made-up name at `example.com`. Each script stops unless it is
   on `workshops_demo`. Run the seed once per fresh copy, because it copies
   sessions in.

2. **Run the app against it** from a scratch copy of `frontend/` on :3100 (as in
   TESTING.md, "A screenshot of a signed-in page"). Its `.env` holds only
   `DATABASE_URL` (pointed at `workshops_demo`), `AUTH_SECRET`, `AUTH_URL` and
   dummy `AUTH_GOOGLE_*`. No Slack, HiBob, Harness or Deepgram keys, so
   nothing a step does can reach a real person. Never point a capture at QA or
   production.

3. **Write the scenes.** `content/<id>/scene-N-name.txt` as for an explainer,
   and `src/videos/<id>.tsx`, which exports `shots` (each scene's steps) and,
   as its default, `trainingVideo("<id>", shots)`. A step names its target as a
   Playwright selector and the spoken phrase it lands on (`lib/training.ts`):

   ```ts
   { do: "click", target: 'role=switch[name="Me"s]', at: "turn on Me" }
   ```

4. **Capture, narrate, check, render:**

   ```bash
   npx tsx cli/capture.ts <id> --session demo-judge-token   # performs every step in Chrome
   npx tsx cli/narrate.ts <id>
   npx tsx cli/render.ts <id> --stills 300,900              # look at each scene
   npx tsx cli/render.ts <id>
   npx tsx cli/transcript.ts <id>                           # out/<id>.txt and out/<id>.vtt
   ```

   Capture again whenever the app or the steps change. Narration only
   regenerates scenes whose text changed.

## Rules

STANDARDS.md applies where it fits: plain words, no regionalisms, acronyms
hyphenated, everything shown is spoken, and no mid-section pauses. The level
rules and the single analogy are for explainers and don't apply here. On top
of those:

- **One persona, one job per video.** Name the persona in the first sentence
  ("As a guest judge, …"). If a second job needs explaining, it gets its own
  video; end the first by naming it.
- **Say the control's name as the app shows it**, and land the step on it:
  "click **Submit**" with `at: "click Submit"`. The viewer should be able to
  find it by what they heard.
- **Show only what the persona can do.** Capture as that persona's session, never
  as an administrator, so the sidebar and the controls are theirs.
- **Point, then act.** A `point` rings a thing while it is explained; a `click`
  does it. Zoom (`zoom: 1.6`) when the text is too small to read at 1080p, and
  set `zoom: 1` to come back out.
- **Describe the app as it behaves.** If a step surprises you (a judge can open
  a session card; Submit returns to the full list, not Assigned to me), the
  narration follows the app, not the expectation.
- **Close with a one-line recap** that points at each control again.
- **The demo data is part of the video.** Seed what the persona needs to see
  (their sessions, their group) in the persona's seed script, so a capture
  next month shows the same thing.
