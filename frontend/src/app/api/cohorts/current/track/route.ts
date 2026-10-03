/**
 * A candidate's track. PUT sets one person's by hand, any track at any time;
 * POST decides an undecided one by putting their title on a list, which
 * moves everyone with the title.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { EVALS_TITLE_LISTS } from "@/db/schema";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { setTrack, sortUndecidedTitle, TRACK_CHOICES, type SortTitleError } from "@/lib/evals/tracks";
import { canManageTrainingSettings } from "@/lib/roles";

const bodySchema = z.object({
  email: z.string().min(1).max(320),
  list: z.enum(EVALS_TITLE_LISTS),
});

const setSchema = z.object({
  email: z.string().min(1).max(320),
  track: z.enum(TRACK_CHOICES),
});

const STATUS: Record<SortTitleError, number> = { not_found: 404, not_undecided: 409, no_title: 400 };

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const sorted = await sortUndecidedTitle(user.id, parsed.data.email, parsed.data.list);
  if (!sorted.ok) return NextResponse.json({ error: sorted.error }, { status: STATUS[sorted.error] });
  return NextResponse.json(sorted.result);
});

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = setSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const set = await setTrack(user.id, parsed.data.email, parsed.data.track);
  if (!set.ok) return NextResponse.json({ error: set.error }, { status: 404 });
  return NextResponse.json(set.result);
});
