/**
 * The Google Meetings tab: the Revenue Enablement calendar meetings picked for
 * the cohort, or the sync's log, a page at a time; the accounts it uses; dry
 * run or live; and Preview and Sync Now.
 */

import { googleMeetingsOverview, listMeetingSelections, listMeetingSyncRuns } from "@/lib/evals/google-meetings";
import { MEETING_SELECTION_LIST, MEETING_SYNC_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { GoogleMeetingsView } from "./google-meetings-view";

export default async function GoogleMeetingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const overview = await googleMeetingsOverview();
  const { connection, zoom, lastLiveSync } = overview;
  const serialized = {
    ...overview,
    connection: connection && { ...connection, connectedAt: connection.connectedAt.toISOString() },
    zoom: { ...zoom, connection: zoom.connection && { ...zoom.connection, connectedAt: zoom.connection.connectedAt.toISOString() } },
    lastLiveSync: lastLiveSync && { ...lastLiveSync, finishedAt: lastLiveSync.finishedAt.toISOString() },
  };

  // A hand-typed `view` that isn't one shows the meetings, as a bad sort does.
  if (params.view === "runs") {
    const query = parseListQuery(params, MEETING_SYNC_LIST);
    const page = await listMeetingSyncRuns(query);
    return (
      <GoogleMeetingsView
        overview={serialized}
        list={{
          view: "runs",
          query,
          page: {
            ...page,
            rows: page.rows.map((run) => ({
              ...run,
              startedAt: run.startedAt.toISOString(),
              finishedAt: run.finishedAt?.toISOString() ?? null,
            })),
          },
        }}
      />
    );
  }

  const query = parseListQuery(params, MEETING_SELECTION_LIST);
  const page = await listMeetingSelections(query);
  return (
    <GoogleMeetingsView
      overview={serialized}
      list={{
        view: "meetings",
        query,
        page: {
          ...page,
          rows: page.rows.map((m) => ({
            ...m,
            syncedAt: m.syncedAt?.toISOString() ?? null,
            nextStartsAt: m.nextStartsAt?.toISOString() ?? null,
            createdAt: m.createdAt.toISOString(),
          })),
        },
      }}
    />
  );
}
