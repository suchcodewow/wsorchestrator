/**
 * The Map Editor: the live concept map's sections, groups and concepts, with
 * what each concept depends on, changed in place and saved as a new version;
 * and every version before it, any of which can be put back. Videos are not
 * edited here: each concept keeps its own, whichever version is live.
 */

import { MAP_VERSION_LIST } from "@/lib/list-specs";
import { getMap, listMapVersions } from "@/lib/mimir/map/content";
import { withoutVideos } from "@/lib/mimir/map/schema";
import { parseListQuery } from "@/lib/paging";
import { MapEditorView } from "./map-editor-view";

export default async function MapEditorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseListQuery(await searchParams, MAP_VERSION_LIST);
  const [map, versions] = await Promise.all([getMap(), listMapVersions(query)]);
  return (
    <MapEditorView
      live={map && { version: map.version, savedAt: map.importedAt.toISOString(), content: withoutVideos(map.content) }}
      query={query}
      versions={versions}
    />
  );
}
