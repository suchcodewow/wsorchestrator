/** The Google Meetings tab: the meetings still to end, or those past, a page at a time, and the account their invites go out from. */

import { googleMeetingsOverview, isMeetingWhen, listGoogleMeetings } from "@/lib/evals/google-meetings";
import { GOOGLE_MEETING_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { GoogleMeetingsView } from "./google-meetings-view";

export default async function GoogleMeetingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = parseListQuery(params, GOOGLE_MEETING_LIST);
  // A hand-typed `when` that isn't one shows the upcoming, as a bad sort does.
  const when = isMeetingWhen(params.when) ? params.when : "upcoming";
  const [page, overview] = await Promise.all([listGoogleMeetings(when, query), googleMeetingsOverview()]);
  const { connection } = overview;

  return (
    <GoogleMeetingsView
      query={query}
      when={when}
      page={{
        ...page,
        rows: page.rows.map((m) => ({
          ...m,
          startsAt: m.startsAt.toISOString(),
          syncedAt: m.syncedAt?.toISOString() ?? null,
        })),
      }}
      overview={{
        ...overview,
        connection: connection && {
          ...connection,
          connectedAt: connection.connectedAt.toISOString(),
          lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
        },
      }}
      returned={typeof params.google === "string" ? params.google : null}
    />
  );
}
