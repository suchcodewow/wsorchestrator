import { NextResponse } from "next/server";
import { z } from "zod";
import { CLAIM_LIMITS } from "@/db/schema";
import {
  claimAccount,
  getAttendeeView,
  type ClaimError,
} from "@/lib/attendees";

/**
 * The attendee endpoints. Unlike everything under `/api/runs`, these take no
 * session — an attendee walking into the room has no account here, and the
 * unguessable event id in the URL is what stands in for one. `getAttendeeView`
 * is the boundary that keeps that from meaning "anyone can read the run".
 */

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

const claimSchema = z.object({
  accountId: z.number().int().positive(),
  name: z.string().min(1).max(CLAIM_LIMITS.name),
  from: z.string().max(CLAIM_LIMITS.from),
  vacation: z.string().max(CLAIM_LIMITS.vacation),
});

const STATUS_FOR: Record<ClaimError, number> = {
  not_found: 404,
  already_claimed: 409,
  invalid: 400,
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const parsed = claimSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const { id } = await params;
  const { accountId, ...input } = parsed.data;
  const result = await claimAccount(id, accountId, input);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ account: result.account });
}
