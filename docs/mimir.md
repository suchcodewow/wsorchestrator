# Mimir

Mimir teaches the course one concept at a time. It has two tabs:

- **Chat** is a coach that walks you through the course in order. It opens by
  saying how far through you are and asking what you know about the next
  concept. Each concept has a checklist of two to six main points, shown above
  the conversation. The coach ticks a point as soon as you have put it in your
  own words, in whichever message and however loosely, and then asks only
  about the points still open; it never asks you to restate the lot. When
  every point is ticked the concept is mastered and it moves on. If you don't
  know the concept, it links its video and flags it **Recommended** on the
  map. When you come back after watching, it asks about the open points.
- **Map** is the concept map: the slides (headed EMD) in the first column,
  then a column per level, Level 100 to Level 300. No lines show until you
  click something, or turn on **Show all connections**; a solid line then runs
  from each slide to each concept it needs, and a dashed one from each concept
  to the lower-level concepts it requires. Clicking a slide hides the concepts
  it does not need, and the columns keep their places. Point at a slide for its
  picture, or at anything else for its details. The
  chips under the title filter the map to one section of the slides (Core
  Pitch, say) and the concepts those slides rely on; press the chip again to
  see everything. Each concept with a video has a play button whose ring
  fills as you watch and turns into a check when you have watched it to the
  end. A concept the coach has marked shows a check; one it asked you to watch
  shows **Recommended**.

The previous Mimir (a reference library with a coach per card) is kept, read
only, for Training Administrators at `/mimir-archive`. It no longer coaches or
records progress. Its tables and its API routes are untouched.

## The content is private

The repository is public and the course is not, so nothing about it is
committed. It is imported:

```bash
cd frontend
npx tsx scripts/mimir-map-convert.ts \
  --concepts ~/Downloads/concept-data.json \
  --extras ~/Downloads/mimir-map-extras.json \
  --videos ~/path/to/explainer-video/out \
  --scripts ~/path/to/explainer-video/content \
  > ~/Downloads/mimir-map-content.json
```

then loaded in **Mimir Settings → Map** (or `POST /api/mimir/map/import`). The
file holds the slides, the concepts and their order (each may list `requires`, the lower-level concepts to understand first), the groups and levels, and for each concept with a video, where it is kept and what the
narrator says in it (which is how the coach knows each video). It is validated
whole against `src/lib/mimir/map/schema.ts` and replaces the last one. Progress
is keyed by concept id, so everyone's progress on a concept the new map keeps
carries over. `.gitignore` refuses `mimir-map-content*.json` as a backstop.

## The videos

Each environment keeps them in its own private recordings bucket
(`<admin project>-recordings`, `infra/admin/recordings.tf`) under
`mimir/videos/`. That prefix is clear of the ones its lifecycle rules delete
(`recordings/files/`, `recordings/chunks/`, `recordings/compose/`), so they stay until someone removes them. No
video passes through the app: it hands the browser a signed link (3 hours) and
the browser plays the file from Cloud Storage, so seeking works.

Upload them, once per environment, as yourself:

```bash
gcloud auth login
frontend/scripts/mimir-upload-videos.sh qa ~/path/to/explainer-video/out
frontend/scripts/mimir-upload-videos.sh production ~/path/to/explainer-video/out
```

**Mimir Settings → Map** lists every video and whether this environment has it.
A concept whose video is missing says so when someone presses play. Replacing a
video is uploading over the same object name.

Locally, `docker compose --profile recordings up -d gcs`, then set
`RECORDINGS_BUCKET=recordings-dev` and `STORAGE_EMULATOR_HOST=http://localhost:4443`
in `frontend/.env`, create the bucket in the emulator and upload to
`mimir/videos/` there (see [recordings.md](recordings.md)). Without a bucket the
Map still shows, but the play buttons are disabled.

## The slide pictures

Pointing at a slide along the top of the map shows the slide itself above its
details in the popup. The pictures are the course's, so like the videos they are
uploaded rather than committed, to the same private bucket under
`mimir/slides/<n>.jpg`, where `<n>` is the slide's number. The browser asks the
app for `/api/mimir/map/slides/<n>`, which answers with a signed Cloud Storage
link, so the image never passes through the app. A slide with no picture just
has no image in its popup; nothing else changes, so each environment can have
them or not.

Export the deck from PowerPoint with File → Export → PNG (all slides), then:

```bash
cd frontend
npx tsx scripts/mimir-slides-prepare.ts ~/path/to/exported-pngs ~/path/to/slides-out
gcloud auth login
scripts/mimir-upload-slides.sh qa ~/path/to/slides-out
scripts/mimir-upload-slides.sh production ~/path/to/slides-out
```

The first writes each slide as a 960-pixel-wide JPEG named by its number; the
second uploads them, overwriting any already there. Replacing the deck is doing
it again. Locally the pictures need the same emulator and bucket as the videos
(above); without a bucket the popup simply has no picture.

## Where you left off

The player reports where it is: every 30 seconds while playing, when you pause
or seek, when the video ends, and when you close it or leave the page. Each
report is an audited `PUT /api/mimir/map/concepts/{id}/video`.

- Pressing play on a video you stopped part-way carries on from where you
  stopped. If you had stopped in the last 3 seconds, or it had ended, it starts
  over.
- The ring shows the furthest point you have reached. A video counts as watched
  once it plays to the end, or you reach the last 5%, and that is kept if you
  watch it again.

## The coach

It is the same coach Mimir has always had (same model, same plain-English,
check-in-your-own-words style, and the same **Coaching** settings and your
role and coaching style), pointed at the course. One conversation per person.

- Its system prompt is the whole course in study order, each concept's
  explanation and, for each video, the narrator's words. It is fixed when the
  conversation starts, so a re-import reaches the next conversation (**New
  conversation** starts one).
- It is handed a short **progress snapshot** whenever your progress has moved
  (a video finished, a concept marked), and a hidden "I just opened Mimir"
  when you open the tab after 30 minutes away or after your progress changed,
  so it greets you with where you are.
- It acts through markers on a line of their own at the end of a reply. The
  app reads them, applies them, and never shows them. A marker for a concept
  that is not in the course does nothing; at most one of each takes effect per
  reply.
  - `[POINTS: concept-id | point | point …]` sets out a concept's checklist,
    two to six points. Only for a concept the import gave no `points`, and
    only once per person: the first checklist stands, so the target never
    moves.
  - `[COVERED: concept-id 1 3]` ticks points by number. Ticks are kept, and
    the tick that completes a checklist marks the concept mastered and clears
    Recommended.
  - `[MASTERED: concept-id]` masters a concept outright, for a rep who plainly
    knows it all; `[RECOMMEND: concept-id]` flags its video.
- The progress snapshot lists the next concept's checklist, which points are
  covered and which are open, so it carries over a new conversation or a day
  away.
- A concept in the import may carry `points`: two to six strings of up to
  160 characters, its main points as the author wants them checked. Those win
  over any the coach set out, and ticks carry across a re-import for a point
  whose wording is unchanged.
- A conversation started before checklists existed is replaced the next time
  you open the tab; progress, mastery and videos watched stay.
- "Next" is always the lowest-numbered concept you have not mastered.
- It needs `ANTHROPIC_API_KEY`. Without one the map and videos still work.

## Data

| Table | Holds |
| --- | --- |
| `mimir_map` | The imported map: one row, `current`. |
| `mimir_concept_progress` | Per person per concept: where they left off, the furthest reached, when the video was finished, when the coach marked it mastered or recommended it, and its checklist (`points`: each point and whether it is covered). |
| `mimir_coach_conversations`, `mimir_coach_messages` | One conversation per person with the map coach. |

Every list is capped at 100 rows (`MAP_CONCEPT_LIMIT`), the most the importer
accepts, and the coach's messages are paged like the rest of Mimir's.
