# Mimir Studio

The app's way of making Mimir's explainer videos, with the same engine, rules
and checks as making them by hand (`../README.md`, `../STANDARDS.md`). It is
one Cloud Run job, `mimir-studio`, built from `../Dockerfile`. Each execution
does one row of `mimir_studio_jobs`:

- **A deck job** (Mimir Settings → Map → Upload a new deck). It turns the
  uploaded PPTX into slide pictures with LibreOffice and poppler. Claude reads
  every slide and drafts a 100/200/300-level concept map. The draft keeps the
  live map's concept ids wherever a concept carries over. It waits on the Map
  tab, with what it would change, until someone publishes or discards it.
- **A video job** (Mimir Settings → Mimir Feedback → Regenerate). Claude makes
  one concept's video through the tools in `video.ts`, following `AGENT.md`,
  `STANDARDS.md` and `README.md`. Every accepted comment on the previous video
  is passed in as a note, with its timestamp. The tools refuse to finish until
  the video has been narrated, typechecked, sound-checked, looked at, rendered
  and inspected since the last change. The MP4 lands in the bucket and the
  concept points at it.

The job writes its own job's row, an audit record when it finishes or fails,
its concept's video, and objects under `mimir/` in the recordings bucket.

## Nothing from the deck is in git

The repository is public. Scripts, scene code, narration, slides and the
concept map live in the bucket (under `mimir/studio/`: `reference/`,
`videos/<id>/`, `uploads/` and `drafts/<job>/`) and the database, never here. A job copies the engine
into a scratch workspace and fetches the rest. Tests use made-up concepts.

## Setting up a deployment

1. Put the ElevenLabs key in Harness as the secret `tf_eleven_labs_token` and
   set the workspace variable `eleven_labs_token` from it, as
   `anthropic_api_key` is set. With both set, the next apply creates the job,
   its service account and `MIMIR_STUDIO_JOB` on the app.
2. Once, give video jobs the hand-made videos to start from. This uploads the
   approved reference video and every video's sources from an explainer-video
   checkout that has them. It needs write access to that deployment's bucket:

   ```bash
   RECORDINGS_BUCKET=<project>-recordings npx tsx studio/seed-reference.ts <checkout>
   ```

   Without it, a video job fails at once: "There is no reference video under
   mimir/studio/reference/; run studio/seed-reference.ts first."

## Running it locally

Under `npm run dev` the app starts the job on this machine (`npm run job --
<id>` here) rather than on Cloud Run. It reads `ANTHROPIC_API_KEY` and
`ELEVEN_LABS_TOKEN` from `frontend/.env` and never prints them. It needs:

- the bucket emulator (`docker compose --profile recordings up -d gcs`), with
  `RECORDINGS_BUCKET` and `STORAGE_EMULATOR_HOST` set in `frontend/.env`, and
  `seed-reference` run against it;
- for deck jobs, LibreOffice (`soffice`), poppler (`pdftoppm`) and `unzip`.
  Set `SOFFICE_PATH` if `soffice` is not on the PATH.

`npm run typecheck` checks the engine and the studio together.

## How it differs from making a video by hand

The image renders on Linux, where the Mac's fonts are not available. Text
falls back to Liberation Sans and emoji to Noto Color Emoji, so a video made
here looks slightly different from one made on the Mac. Narration is cached
per scene by its text, in `timing.json` beside the MP3s, as it is by hand.
`seed-reference` uploads whatever audio a checkout has. A scene with no cached
audio is narrated again, which spends ElevenLabs credits.
