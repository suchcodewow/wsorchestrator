/** The attendee page's endpoints. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { CLAIM_LIMITS } from "@/db/schema";
import {
  getAttendeeView,
  saveAttendeeFields,
  type SaveFieldsError,
} from "@/lib/attendees";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const view = await getAttendeeView(id);
  if (!view) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(view);
}

const saveSchema = z.object({
  accountId: z.number().int().positive(),
  name: z.string().max(CLAIM_LIMITS.name),
  from: z.string().max(CLAIM_LIMITS.from),
  vacation: z.string().max(CLAIM_LIMITS.vacation),
});

const STATUS_FOR: Record<SaveFieldsError, number> = {
  not_found: 404,
  invalid: 400,
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const { id } = await params;
  const { accountId, ...input } = parsed.data;
  const result = await saveAttendeeFields(id, accountId, input);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ ok: true });
}
