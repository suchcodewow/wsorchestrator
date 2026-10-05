/**
 * The Additional Channel Contacts tab: the Bootcamp Contacts, added to the
 * active bootcamp's `sales-` Slack channels, and the Engineer Contacts, added
 * to its `se-` ones. The search is shared; each list sorts and pages on its
 * own, under its own name in the URL (`sales.sort`, `se.page`).
 */

import { CHANNEL_CONTACT_KINDS, type ChannelContactKind } from "@/db/schema";
import { channelContactCounts, listChannelContacts } from "@/lib/cohorts/channel-contacts";
import { activeCohortChannels } from "@/lib/cohorts/slack-sync";
import { CHANNEL_CONTACT_LIST, type ChannelContactSort } from "@/lib/list-specs";
import { parseListQuery, type ListQuery } from "@/lib/paging";
import { ChannelContactsView, type ContactList } from "./channel-contacts-view";

export default async function ChannelContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const queries = Object.fromEntries(
    CHANNEL_CONTACT_KINDS.map((kind) => [kind, parseListQuery(params, CHANNEL_CONTACT_LIST, kind)]),
  ) as Record<ChannelContactKind, ListQuery<ChannelContactSort>>;

  const [pages, counts, active] = await Promise.all([
    Promise.all(CHANNEL_CONTACT_KINDS.map((kind) => listChannelContacts(kind, queries[kind]))),
    channelContactCounts(),
    activeCohortChannels(),
  ]);

  const lists = {} as Record<ChannelContactKind, ContactList>;
  CHANNEL_CONTACT_KINDS.forEach((kind, i) => {
    const page = pages[i]!;
    lists[kind] = {
      query: queries[kind],
      count: counts[kind],
      channels: active?.channels.filter((c) => c.kind.startsWith(`${kind}_`)).map((c) => c.name) ?? [],
      page: { ...page, rows: page.rows.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })) },
    };
  });

  return <ChannelContactsView q={queries.sales.q} lists={lists} />;
}
