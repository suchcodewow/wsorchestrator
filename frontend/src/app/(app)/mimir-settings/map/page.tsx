/**
 * The concept map: importing it, drafting a new one from a slide deck through
 * Mimir Studio, and which of its videos are in this environment's bucket.
 */

import { auth } from "@/auth";
import { getMap } from "@/lib/mimir/map/content";
import { videosPresent } from "@/lib/mimir/map/video";
import { latestDeckJob } from "@/lib/mimir/studio/jobs";
import { draftOf } from "@/lib/mimir/studio/publish";
import { diffMaps, withLiveVideos } from "@/lib/mimir/studio/shapes";
import { studioConfigured } from "@/lib/mimir/studio/trigger";
import { canRunMimirStudio } from "@/lib/roles";
import { MapSettingsView } from "./map-settings-view";

export default async function MapSettingsPage() {
  const [map, session] = await Promise.all([getMap(), auth()]);
  const videos = map?.content.concepts.flatMap((c) => (c.video ? [{ id: c.id, name: c.name, object: c.video.object, seconds: c.video.seconds }] : [])) ?? [];
  const access = session?.user?.access;
  const canStudio = Boolean(access && canRunMimirStudio(access));
  const [present, job] = await Promise.all([videosPresent(videos.map((v) => v.object)), canStudio ? latestDeckJob() : null]);

  const result = job?.status === "ready" ? draftOf(job) : null;
  const live = map?.content ?? null;
  const draft = result && {
    summary: result.summary,
    slides: result.draft.slides,
    diff: diffMaps(live, withLiveVideos(result.draft, live)),
  };

  return (
    <MapSettingsView
      summary={map && { importedAt: map.importedAt.toISOString(), concepts: map.content.concepts.length, slides: map.content.slides.length }}
      videos={videos.map((v) => ({ ...v, present: present ? present[v.object]! : null }))}
      studio={
        canStudio
          ? {
              configured: studioConfigured(),
              job: job && {
                id: job.id,
                status: job.status,
                label: job.label,
                progress: job.progress,
                error: job.error,
                createdAt: job.createdAt,
                finishedAt: job.finishedAt,
              },
              draft,
            }
          : null
      }
    />
  );
}
