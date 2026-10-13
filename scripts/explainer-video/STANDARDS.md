# Explainer video standards

Every video in this directory follows these rules. They were settled while making
video 1 (CI/CD pipelines), including the things the author rejected. If a rule
here conflicts with your instinct, the rule wins. If a rule seems wrong, say so
rather than quietly breaking it.

Read `src/videos/01-pipelines.tsx` and `content/01-pipelines/` (local files, not in
git) before writing a new video. They are the reference.

## Audience and goal

A technical expert teaching a **field sales team**. At Level 100 assume the
audience knows nothing about software delivery, AI, security or cloud. Each video
explains **one concept**, as long as it needs and no longer. A video about
pipelines is longer than one about pull requests. Aim for clear, not for a target
length (video 1 runs about 3:50).

Tone: a knowledgeable colleague, plain words, one good analogy, a little humor.

## Level discipline (the most important rule)

The course has four levels. Colors: 100 green, 200 blue, 300 purple, 400 amber
(`LEVELS` in `src/ui.tsx`; the level only sets the accent color).

- A video may use **only** ideas from its own level or lower. A Level 100 video
  never explains something with a Level 200/300 concept (SAST, policy-as-code,
  canary, reachability, MCP, and so on).
- Inside Level 100 a video may lean on the concepts that come **earlier** in
  `study_order` (see `source/concept-data.json`) and nothing later.
- If you must name a later concept, name it in passing in plain words, never rely
  on it, never put it on screen as a term to learn.
- Define every term the first time it is spoken, in everyday words.

Level 100 videos, in order (ids are the file and folder names):

| # | id | Concept |
|---|----|---------|
| 1 | `01-pipelines` | CI/CD pipelines |
| 2 | `02-pull-requests` | Pull request (PR) |
| 3 | `03-microservices` | Microservices |
| 4 | `04-infrastructure-and-databases` | Infrastructure and database deployments |
| 5 | `05-jenkins-legacy` | Jenkins and legacy tooling |
| 6 | `06-toil` | Toil and manual process |
| 7 | `07-risk-blast-radius` | Risk and blast radius |
| 8 | `08-compliance` | Compliance and regulators |
| 9 | `09-human-in-the-loop` | Human-in-the-loop and approvals |
| 10 | `10-audit-trail` | Audit trail and chain of custody |
| 11 | `11-ai-coding-agents` | AI coding agents |
| 12 | `12-llms` | LLMs, tokens and hallucination |
| 13 | `13-deterministic-vs-agentic` | Deterministic vs. agentic steps |

## Writing the script

One text file per scene: `content/<id>/scene-<n>-<name>.txt`. A scene is a
section of the explanation: the problem, the idea, how it works, why it matters,
a recap. About 4 to 7 scenes.

- **Analogy:** pick one and keep it for the whole video. Do not switch analogies
  mid-video (the author found switching confusing). Video 1 uses a bakery; reuse
  it where it fits so the series feels connected, otherwise pick something
  equally everyday. A recurring gag is fine: "Dave" is the person doing it by hand.
- **Open** with the problem or a picture the viewer recognizes, not a definition.
- **Close** with a one-breath recap that restates the idea in the video's own words.
- **Accuracy:** explain the concept as it is in the industry. Do not invent
  product features, numbers or customer claims. The concept data in
  `source/concept-data.json` says how the deck uses each concept; follow it.
- **Everything shown is spoken.** Every label, icon meaning, number or word that
  appears on screen must be said in the narration. If you add a visual, add the
  words that explain it. If you cut a sentence, cut its visual.
- **Wording from the author wins.** When the author gives you narration, use it
  verbatim. Additions that make it work (defining a term) must be called out.
- **Spell acronyms with hyphens** so the voice says the letters: `C-I`, `C-D`,
  `L-L-M`. Say numbers and symbols as words.
- Straight quotes and apostrophes only. Phrases are matched against the spoken
  characters, so the text must be what you want said.
- Humor: light. A visual gag beats a joke line. Never at the audience's expense.

### Pauses

Narration flows. Pauses are rare and deliberate.

- `[pause N]` on its own line leaves N seconds of silence.
- Put pauses **only at the end of a section** (about 0.8 to 1.0 s), and for a
  **gag beat** that needs room for a sound (the sad trombone used 2.8 s, the horn
  1.9 s).
- Never pause in the middle of a sentence, and never between sentences of one
  thought. The author rejected "pauses for breath at weird places" twice.

## Narration

- ElevenLabs, voice **Shawn Pearson** (professional clone), model
  `eleven_multilingual_v2`. Settings are in `lib/config.ts`. Do not change voice,
  model or settings without asking.
- Generate with `npx tsx cli/narrate.ts <id>`. It only regenerates scenes whose
  text changed, so editing is cheap. Do not re-run needlessly: it costs credits.
- The token is `ELEVEN_LABS_TOKEN` in `frontend/.env`. It is read at runtime and
  never printed, logged, copied or committed. Never echo it, never put it in a
  command line or a file.

## Visuals

1080p, 30 fps, built with Remotion. Dark navy background, white text, the level
accent color. The author liked the text on the slides: short, large, plain.

- **No header or numbering.** No level chip, no "N of 13", no logo. They go stale
  as videos are edited. The thin progress bar at the bottom and the accent color
  are the only constant chrome.
- Use the shared pieces in `src/ui.tsx`: `Headline`, `Reveal`, `Pop`, `Card`,
  `Station`, `Belt`, `Bubble`, `Emoji`, `ease`, `useScene`. Use emoji for icons.
  Do **not** use the shield emoji (jagged); draw a clean outline SVG instead.
- **Anchor every animation to the spoken word.** `at("login button")` is the frame
  the phrase starts, `atEnd(...)` when it ends. Reveal a visual when its phrase
  is said, not on a timer. A phrase that is not in the scene text fails the build,
  which is how you find typos.
- Highlight the thing being named as it is named (video 1 lights up "bakers", then
  "developers", as each is spoken).
- Group related things in one card or one row. Do not scatter.
- **Layout is stable.** A box must not change size when its text or state changes.
  Keep labels on one line (`whiteSpace: "nowrap"`) and reserve space for text that
  appears later. Leave a term off until it is spoken (video 1 shows "Final
  deployment" and only switches to "Production" when the narrator says it).
- Keep clear of the bottom 10 px (progress bar) and the screen edges.
- Delete anything on screen that the narration does not support.

### Gotchas that already cost time

- `Pop` and `Reveal` wrap children in a transformed div. Do not put an absolutely
  positioned drawing inside `Pop`, it scales around the wrong origin. Use `Reveal`
  with `dy={0}`.
- Do not pass `opacity` in the `style` of `Pop`/`Reveal`: it overrides the
  fade-out and leaves a ghost on screen. Put it on an inner element.
- A box that wraps text on one line and not on another changes height. Use `nowrap`.
- `Emoji` takes any node, so an SVG icon works: wrap it so it centers.

## Sound

Fewer effects is better. Video 1 ends up with **two** gags and a quiet hum.

- Allowed effects live in `lib/sfx-library.ts` plus `beep` (the clown-horn clip,
  `source/clown-horn.mp3`, cut by `cli/sfx.ts`). Use them only for a real visual
  gag: the horn for a truck or a "beep", the trombone for a failure.
- **Never:** record scratch, whoosh or other transition sounds between scenes,
  dings, chimes, or a pop on every reveal. The author rejected each of these.
- No effect may play over the narration. Cues are placed into silences by
  `placeSfx`; give a gag the pause it needs with `[pause N]` (see above). Run
  `npx tsx cli/sfx-report.ts <id>` and confirm "0 overlapping speech" and
  "0 dropped".
- Effects are mixed well under the voice (`SFX_VOLUME` in `src/Explainer.tsx`).
  The loud ones peak at full scale while speech averages about -24 dB, so do not
  raise the level. The final MP4 is loudness-normalized by `cli/render.ts`.
- The conveyor hum is a quiet bed for belt scenes only, faded in and out. Use it
  only if a belt is on screen, and stop it when that scene ends.
- A new effect needs the author's approval first (it costs credits and changes
  the sound of every video).

## Build and verify (every video)

```bash
cd scripts/explainer-video
npx tsx cli/narrate.ts <id>                 # narration + word timings
npx tsc --noEmit -p .                       # typecheck
npx tsx cli/sfx-report.ts <id>              # 0 overlapping speech, 0 dropped
npx tsx cli/render.ts <id> --stills 300,900 # ~1 s per frame: LOOK at every scene
npx tsx cli/render.ts <id>                  # out/<id>.mp4, headless, ~8 min
```

Before calling a video done:

1. Look at at least two frames per scene: layout, overlaps, clipped text, anything
   unspoken. Fix and re-check. Frames come from `--stills`, then Read the PNG.
2. `ffprobe` the MP4: 1920x1080, h264 + aac, duration matches the timing file.
3. Pull a frame from the **final MP4** at one or two cue moments and confirm it.
4. Mean level near -20 dB, no clipping (`ffmpeg ... -af volumedetect`).

Rendering is headless on the installed Chrome (no browser download, no window).
Several renders can run at once; `--concurrency N` caps the tabs each uses.

## Content and git

- **Nothing derived from the deck is committed.** The repo is public. Git keeps
  the engine only: `lib/`, `cli/`, `src/ui.tsx`, `src/Explainer.tsx`,
  `src/Root.tsx`, `README.md`, this file. Gitignored: `source/`, `content/`,
  `public/`, `out/`, and every `src/videos/*.tsx` (its on-screen text is content).
- Videos register themselves: `src/videos/<id>.tsx` with a default `VideoDef`,
  matched to `content/<id>/`. Do not edit `Root.tsx` to add one.
- Do not edit shared files (`src/ui.tsx`, `src/Explainer.tsx`, `src/Root.tsx`,
  `lib/*`, `cli/*`) while making a video. Put one-off helpers in the video's own
  file. If a shared change is needed, ask.
- Do not commit, push or open a PR unless asked. Stage explicit paths if you do.
- Never kill a process you did not start. Never `git add -A`.

## Decision log from video 1

What the author asked for or rejected, in order, so nobody re-litigates it:

1. Drop the record scratch (too distracting) and the whoosh between scenes.
2. Conveyor hum stops at the end of its scene.
3. Keep one analogy (bakery); no flat-pack furniture.
4. Narrate everything on screen; highlight terms as they are spoken.
5. Sad trombone instead of a buzzer; nothing plays over the voice.
6. No pauses mid-section; no dings anywhere; fewer effects overall.
7. A truck "BEEP BEEP" gag, using the clown-horn clip.
8. No header chip or "N of 13".
9. Effects too loud against the voice: mixed about 4 dB under it.
10. Closed gates and x-ray machines instead of shields; a package is scanned and
    gets a green check.
11. Cut segments that confuse (the delivery-vs-deployment comparison).
