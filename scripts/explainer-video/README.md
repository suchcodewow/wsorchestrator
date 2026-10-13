# Explainer videos

Narrated, animated explainers: ElevenLabs narration in a cloned voice, Remotion
motion graphics, rendered headless to MP4. This directory holds only the
pipeline. The source material, transcripts, audio, finished videos and each
video's scene code (`src/videos/*`) are gitignored because they derive from
internal GTM content.

**Read [STANDARDS.md](STANDARDS.md) before making or changing a video.** It holds the
teaching, script, visual and sound rules every video follows.

## What is not in the repo

Everything derived from the course stays out of this public repo (see `.gitignore`), so a fresh clone has only the engine. To make or change a video you also need, from a private backup, these folders in this directory:

- `source/`: the course data (`concept-data.json`) and `clown-horn.mp3` (the truck horn, `cli/sfx.ts` cuts `beep` from it)
- `content/<id>/`: each video's scene scripts
- `src/videos/<id>.tsx`: each video's scene code
- `public/audio/`: generated narration, word timings and effects, so a re-render costs no ElevenLabs credits (`cli/narrate.ts` and `cli/sfx.ts` rebuild it)
- `out/`: the rendered MP4s, which can be re-rendered

With none of them, `src/videos/` is empty and there is nothing to render; start a new video by following [STANDARDS.md](STANDARDS.md).

## Run it

```bash
cd scripts/explainer-video && npm install
npx tsx cli/sfx.ts                     # once: the shared sound-effect set
npx tsx cli/narrate.ts 01-pipelines    # narration + word timings (only changed scenes are regenerated)
npx tsx cli/render.ts 01-pipelines     # -> out/01-pipelines.mp4
npx tsx cli/render.ts 01-pipelines --stills 300,900   # quick frame check, ~1s each
npm run studio                         # live preview in the browser
```

`ELEVEN_LABS_TOKEN` is read at runtime from the environment or `frontend/.env`.
It is never logged or written to a file. The voice ID and models are in
`lib/config.ts`.

Rendering uses the installed Chrome (`CHROME_PATH` to override), so Remotion
downloads no browser.

## How a video is built

1. `content/<id>/scene-N-name.txt`: one narration file per scene.
2. `narrate.ts` generates `public/audio/<id>/scene-N.mp3` plus
   `timing.json`, which has per-character timestamps and each clip's duration
   from `ffprobe`.
3. `src/videos/<name>.tsx` defines the scenes. Animations and sound effects are
   anchored to spoken phrases (`at("login button")`), so they land on the word
   and move with the narration when the script is edited. A phrase that is not
   in the scene text fails the render.
4. Each scene lasts its narration plus a short pause. Register the video in
   `src/Root.tsx`.

Level colors: 100 green, 200 blue, 300 purple, 400 amber (`LEVELS` in `src/ui.tsx`).
