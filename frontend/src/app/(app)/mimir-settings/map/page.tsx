/** The concept map: importing it, and which of its videos are in this environment's bucket. */

import { getMap } from "@/lib/mimir/map/content";
import { videosPresent } from "@/lib/mimir/map/video";
import { MapSettingsView } from "./map-settings-view";

export default async function MapSettingsPage() {
  const map = await getMap();
  const videos = map?.content.concepts.flatMap((c) => (c.video ? [{ id: c.id, name: c.name, object: c.video.object, seconds: c.video.seconds }] : [])) ?? [];
  const present = await videosPresent(videos.map((v) => v.object));

  return (
    <MapSettingsView
      summary={map && { importedAt: map.importedAt.toISOString(), concepts: map.content.concepts.length, slides: map.content.slides.length }}
      videos={videos.map((v) => ({ ...v, present: present ? present[v.object]! : null }))}
    />
  );
}
