/** The Additional Slack Contacts tab: everyone added to each team's end-of-bootcamp Slack message, a page at a time. */

import { listSlackContacts, slackContactCount } from "@/lib/evals/slack-contacts";
import { SLACK_CONTACT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { SlackContactsView } from "./slack-contacts-view";

export default async function SlackContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, SLACK_CONTACT_LIST);
  const [page, count] = await Promise.all([listSlackContacts(query), slackContactCount()]);
  return (
    <SlackContactsView
      query={query}
      page={{ ...page, rows: page.rows.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })) }}
      count={count}
    />
  );
}
