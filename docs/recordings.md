# Async recordings

The recorder is at **`/record`**, the Harness Training Recorder. Anyone in the
org can use it: they sign in with Google, as for the rest of the app, but need
no role, so a first visit just creates an account with no access. They type
their name, turn on their camera, optionally share their screen, and record.
What comes back is a file per stream per take, never one composited video: the
camera with the microphone, and, if they shared one, the screen with any audio
the browser shares with it.

A take belongs to the account that recorded it (`recorded_by`): nobody else can
file a stream on it or upload to it, and a browser shared by two people keeps
each one's unfinished uploads apart.

**Async Recordings** (`/recordings`, under Enablement Tools) is for Training
Administrators only: the address to share, and every take, newest first, under
the name its recorder typed, with a still from five seconds in, a player and
downloads for each file.

## Why it survives a bad connection

Nothing is streamed. Each stream is recorded **in the participant's browser**, by
its own `MediaRecorder`, at the best the device offers up to a cap set in
`src/lib/recording/camera.ts`: 1080p at 30 fps for the camera, and native
resolution up to 1440p at up to 60 fps for the screen. Bitrates are set in
`src/lib/recording/video.ts`: 12 Mbit/s for each. A side-by-side test at 6, 12
and 20 Mbit/s from a laptop webcam showed 6 losing skin and hair texture, and
20 no better than 12. Sharing the screen is optional; a take without it is the
camera file alone. The quality never depends on the network.

| Piece | File | What it does |
| --- | --- | --- |
| Recorder | `src/components/recording/use-take-recorder.ts` | Two recorders, started together. Every 2 s each hands over a chunk, which is written to IndexedDB before anything else happens to it. |
| Local store | `src/lib/recording/store.ts` | The same store the eVals audio recordings use. Since version 2 it also keeps which chunks the server has confirmed. |
| Uploader | `src/lib/recording/uploader.ts` | Runs alongside the recorder. It sends chunks three at a time while the take is still recording, so on a good connection little is left when it stops. On a bad one it falls behind and catches up afterwards. Failures back off from 1 s to 30 s with jitter, and coming back online retries at once. |
| Server | `src/lib/recording/requests.ts`, `storage.ts` | Accepts chunks in any order, any number of times. On *finish* it either lists the chunks it still lacks or joins them into the file. |

Every step can be repeated:

- A stream is registered again on every pass.
- A chunk whose response was lost is sent again and replaces itself.
- *Finish* is asked again until the answer is `ready`.

Which chunks have landed is kept in IndexedDB. Closing the tab, a crash or a
reload costs nothing: opening /record again in the same browser, signed in as the same person, resumes the upload.
The browser deletes its copy only once the server says the file is ready. Until
then, *Save a copy* on the page downloads it straight from IndexedDB.

## Where the video is kept

`src/lib/recording/storage.ts` is the only module that touches it.

**On a deployment, a Cloud Storage bucket** (`infra/admin/recordings.tf`,
named `<admin project>-recordings`, its name passed to the app as
`RECORDINGS_BUCKET`). No video passes through the app:

- **Uploads.** The browser asks `upload-urls` for signed PUT URLs, 25 chunks
  at a time, ahead of need, and uploads each chunk straight to the bucket. One
  audited request covers about 50 seconds of a stream: a few dozen audit rows a
  recording, rather than one a chunk. The same request marks the stream as
  still arriving, which is what the *stalled* flag reads.
- **Joining.** `finish` composes the chunks inside the bucket, 32 at a time
  and then those 32 at a time — an hour of video is about 60 compose calls in
  three rounds — and answers `ready`. It does this before answering, because
  Cloud Run throttles the CPU once a response is sent; only deleting the chunks
  is left to `after()`, and the bucket's lifecycle catches anything it misses.
- **Downloads.** The file route answers with a redirect to a signed GET URL,
  good for 15 minutes; the bucket honours Range, so the admin page's player
  seeks.
- **Signing.** URLs are V4-signed as the app's service account. On Cloud Run
  it has no key, so it signs through IAM Credentials signBlob, which needs
  Service Account Token Creator on itself (`app_self_sign`). The signer is
  pinned to Google's own library's output in `test/unit/recording-gcs-sign.test.ts`.

The joined file is not remuxed in the bucket: it is a fragmented MP4 (Chrome
and Edge) or a WebM without a duration (Firefox). Both play in browsers,
QuickTime, Premiere and Resolve; some tools seek in them slowly. Adding ffmpeg
to the image, or a Cloud Run job, would remux them.

**Locally, the disk** under `RECORDINGS_DIR` (`frontend/.recordings` by
default), when `RECORDINGS_BUCKET` is unset. Chunks come through the app's
chunks route, and the file is joined in the background and remuxed by ffmpeg
when it is on the PATH. Never on Cloud Run, whose disk is memory and not
shared between instances.

**Locally, against the bucket path**, with the Cloud Storage emulator:

```bash
docker compose --profile recordings up -d gcs
```

then `RECORDINGS_BUCKET=recordings-dev` and
`STORAGE_EMULATOR_HOST=http://localhost:4443` in `frontend/.env`. The app
creates the bucket in the emulator on first use. The emulator accepts signed
URLs without checking them, so it proves everything but the signature and the
bucket's CORS, which only a real bucket can.

## Retention

A recording is deleted 90 days after it is made: `RECORDING_RETENTION_DAYS` in
`src/lib/recording/video.ts`, and `recordings_retention_days` in Terraform,
which must agree.

- The bucket's lifecycle deletes `files/` at 90 days, and abandoned `chunks/`
  and `compose/` objects at 7.
- The app never lists or serves a take past 90 days, and deletes its rows (and
  any files) after each new take is filed, a batch at a time, each recorded in
  the audit trail as `recordings.expire` by System. There is no scheduler to
  run.
- The take's page says the day it will be deleted.

`offsetMs` on each stream is when its recorder started after the take's first.
It is usually under 50 ms; it is shown on the take's page and returned by the API.

## Still open

- **Bounding one account's uploads.** Anyone in the org can record, so a cap
  on how much one take, or one account in a day, may upload would bound a
  runaway or a mistake.
- **Remuxing in the bucket**, so every editor seeks the files quickly (above).

## Limits

- Desktop Chrome or Edge. Safari on a Mac shares the screen and records MP4, but is
  untested here. Phones cannot share a screen.
- An hour of both streams is at most about 11 GB in the participant's browser
  storage until it uploads, and much less for a mostly still screen. The page
  warns when less than 4 GB is free.
