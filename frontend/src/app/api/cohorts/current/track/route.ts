/** Decides an undecided candidate's track by putting their title on a list. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { EVALS_TITLE_LISTS } from "@/db/schema";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { sortUndecidedTitle, type SortTitleError } from "@/lib/evals/tracks";
import { canManageTrainingSettings } from "@/lib/roles";

const bodySchema = z.object({
  email: z.string().min(1).max(320),
  list: z.enum(EVALS_TITLE_LISTS),
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
