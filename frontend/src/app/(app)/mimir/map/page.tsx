/** The concept map, with a video and a progress ring for each concept that has one. */

import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signInPath } from "@/auth";
import { getMap } from "@/lib/mimir/map/content";
import { listConceptStates } from "@/lib/mimir/map/progress";
import { publicMap } from "@/lib/mimir/map/schema";
import { videosConfigured } from "@/lib/mimir/map/video";
import { canManageMimir } from "@/lib/roles";
import { MapView } from "./map-view";

export default async function MapPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const [map, states] = await Promise.all([getMap(), listConceptStates(session.user.id)]);
  if (!map) {
    return (
      <div className="max-w-xl rounded-2xl border bg-card p-6 text-sm shadow-sm">
        <p className="font-medium">The map hasn&apos;t been set up yet.</p>
        <p className="mt-1 text-muted-foreground">
          {canManageMimir(session.user.access) ? (
            <>
              Import it in{" "}
              <Link href="/mimir-settings/map" className="font-medium text-foreground underline underline-offset-2">
                Mimir Settings → Map
              </Link>
              .
            </>
          ) : (
            "A Training Administrator imports it. Check back soon."
          )}
        </p>
      </div>
    );
  }
  return <MapView map={publicMap(map.content)} states={states} videos={videosConfigured()} />;
}
