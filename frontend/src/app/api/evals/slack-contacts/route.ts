/** The Additional Slack Contacts, a page at a time, and adding one. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import {
  addSlackContact,
  addSlackContactSchema,
  listSlackContacts,
  slackContactCount,
  STATUS_FOR,
} from "@/lib/evals/slack-contacts";
import { SLACK_CONTACT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, SLACK_CONTACT_LIST);
  const [{ rows, page, hasMore }, total] = await Promise.all([listSlackContacts(query), slackContactCount()]);
  return NextResponse.json({ contacts: rows, page, hasMore, total });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const parsed = addSlackContactSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await addSlackContact(user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS_FOR[result.error] });
  }
  noteAudit({ target: result.contact.id, targetLabel: result.contact.email });
  return NextResponse.json(result.contact);
});
