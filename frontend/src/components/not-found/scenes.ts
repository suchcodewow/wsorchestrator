/**
 * The 404 scenes, one of which is drawn at random for each miss.
 *
 * `?scene=<name>` on any missing URL pins one, for showing a particular scene
 * to someone or for checking a change to it.
 */

import { BlueScreen } from "./blue-screen";
import { GameOver } from "./game-over";
import { LostInSpace } from "./lost-in-space";
import { MissingPoster } from "./missing-poster";
import { Newspaper } from "./newspaper";
import { Pipeline } from "./pipeline";
import { Toybox } from "./toybox";

type Scene = (props: { path: string }) => React.ReactNode;

export const SCENES = {
  toybox: Toybox,
  "blue-screen": BlueScreen,
  pipeline: Pipeline,
  space: LostInSpace,
  newspaper: Newspaper,
  arcade: GameOver,
  poster: MissingPoster,
} satisfies Record<string, Scene>;

export type SceneName = keyof typeof SCENES;

const NAMES = Object.keys(SCENES) as SceneName[];

/** The scene asked for by name, or a random one when none (or no such) is asked for. */
export function pickScene(requested: string | null, random: () => number = Math.random): SceneName {
  if (requested && Object.hasOwn(SCENES, requested)) return requested as SceneName;
  return NAMES[Math.floor(random() * NAMES.length)]!;
}
