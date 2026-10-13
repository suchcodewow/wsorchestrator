/** The concept map and where you are on it: reading it, for anyone signed in. Importing it is `map/import`. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getMap } from "@/lib/mimir/map/content";
import { listConceptStates } from "@/lib/mimir/map/progress";
import { publicMap, type MapResponse } from "@/lib/mimir/map/schema";
import { videosConfigured } from "@/lib/mimir/map/video";

export async function GET(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const [map, states] = await Promise.all([getMap(), listConceptStates(user.id)]);
  const body: MapResponse = {
    map: map && publicMap(map.content),
    importedAt: map?.importedAt.toISOString() ?? null,
    states,
    videos: videosConfigured(),
  };
  return NextResponse.json(body);
}
