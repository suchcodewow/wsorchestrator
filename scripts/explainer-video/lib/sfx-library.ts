/**
 * Sound effects generated with ElevenLabs, shared by every video. Generated once, then cached in public/audio/sfx.
 * `beep` is not here: it is cut from a clip the user supplied (source/clown-horn.mp3), see cli/sfx.ts.
 */
export const SFX: Record<string, { prompt: string; seconds: number; loop?: boolean }> = {
  trombone: { prompt: "Comedic sad trombone failure sound, wah wah wah waaah, descending slide", seconds: 2.5 },
  conveyor: { prompt: "Quiet factory conveyor belt hum with soft rhythmic clicking, steady loop", seconds: 6, loop: true },
};
