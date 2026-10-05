/** One kind of Additional Channel Contact, a page at a time, and adding one. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import {
  addChannelContact,
  addChannelContactSchema,
  channelContactCounts,
  isChannelContactKind,
  listChannelContacts,
  STATUS_FOR,
} from "@/lib/cohorts/channel-contacts";
import { CHANNEL_CONTACT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const kind = params.get("kind");
  if (!isChannelContactKind(kind)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const query = parseListQuery(params, CHANNEL_CONTACT_LIST);
  const [{ rows, page, hasMore }, counts] = await Promise.all([listChannelContacts(kind, query), channelContactCounts()]);
  return NextResponse.json({ contacts: rows, page, hasMore, total: counts[kind] });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = addChannelContactSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await addChannelContact(user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS_FOR[result.error] });
  }
  noteAudit({ target: result.contact.id, targetLabel: result.contact.email, detail: { kind: result.contact.kind } });
  return NextResponse.json(result.contact);
});
