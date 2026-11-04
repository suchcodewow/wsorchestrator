/** Mimir's video library: every concept in the course with its video, grouped as the map groups them. */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { getMap } from "@/lib/mimir/map/content";
import { listConceptStates } from "@/lib/mimir/map/progress";
import { publicMap } from "@/lib/mimir/map/schema";
import { videosConfigured } from "@/lib/mimir/map/video";
import { canManageMimir } from "@/lib/roles";
import { MapMissing } from "../map/map-missing";
import { VideoLibrary } from "./video-library";

export default async function VideoLibraryPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const [map, states] = await Promise.all([getMap(), listConceptStates(session.user.id)]);
  if (!map) return <MapMissing canManage={canManageMimir(session.user.access)} />;
  return <VideoLibrary map={publicMap(map.content)} states={states} videos={videosConfigured()} />;
}
