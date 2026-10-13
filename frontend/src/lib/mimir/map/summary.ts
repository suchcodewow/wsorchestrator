/** Where one person stands across the whole map, for the Mimir header and the Welcome page. */

import "server-only";

import { getMap } from "./content";
import { listConceptStates } from "./progress";
import { conceptsInOrder } from "./schema";

export type MapSummary = {
  total: number;
  mastered: number;
  /** Concepts whose video they have watched to the end. */
  watched: number;
  /** Concepts with a video, of the total. */
  withVideo: number;
  /** The lowest-numbered concept not yet mastered; null once all are. */
  next: { id: string; name: string } | null;
};

/** Null until a map has been imported. */
export async function mapSummary(userId: string): Promise<MapSummary | null> {
  const map = await getMap();
  if (!map) return null;
  const states = await listConceptStates(userId);
  const concepts = conceptsInOrder(map.content);
  const next = concepts.find((c) => !states[c.id]?.mastered);
  return {
    total: concepts.length,
    mastered: concepts.filter((c) => states[c.id]?.mastered).length,
    watched: concepts.filter((c) => states[c.id]?.completed).length,
    withVideo: concepts.filter((c) => c.video).length,
    next: next ? { id: next.id, name: next.name } : null,
  };
}
