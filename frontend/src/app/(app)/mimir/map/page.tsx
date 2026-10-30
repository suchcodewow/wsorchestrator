/** The concept map, with a video and a progress ring for each concept that has one. */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { getMap } from "@/lib/mimir/map/content";
import { listConceptStates } from "@/lib/mimir/map/progress";
import { publicMap } from "@/lib/mimir/map/schema";
import { slidesPresent } from "@/lib/mimir/map/slides";
import { videosConfigured } from "@/lib/mimir/map/video";
import { canManageMimir } from "@/lib/roles";
import { WideView } from "@/components/wide-view";
import { MapMissing } from "./map-missing";
import { MapView } from "./map-view";

export default async function MapPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const [map, states, slideImages] = await Promise.all([getMap(), listConceptStates(session.user.id), slidesPresent().catch(() => null)]);
  if (!map) return <MapMissing canManage={canManageMimir(session.user.access)} />;
  return (
    <WideView>
      <MapView map={publicMap(map.content)} states={states} videos={videosConfigured()} slideImages={slideImages ?? []} />
    </WideView>
  );
}
