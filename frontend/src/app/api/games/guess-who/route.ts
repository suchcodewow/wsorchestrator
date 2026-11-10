/** Training → Games → Guess Who: its tool cards, its rounds' mystery tools and its question cap. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { guessWhoConfigSchema } from "@/lib/games/guess-who";
import { getGuessWho, resetGuessWho, setGuessWho } from "@/lib/games/settings";
import { canManageTrainingSettings } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const settings = await getGuessWho();
  return NextResponse.json({
    ...settings.config,
    updatedAt: settings.updatedAt?.toISOString() ?? null,
    updatedBy: settings.updatedBy,
  });
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = guessWhoConfigSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) }, { status: 400 });
  }

  noteAudit({
    target: "guess_who",
    targetLabel: "Guess Who",
    detail: { tools: parsed.data.tools.length, rounds: parsed.data.rounds.length },
  });
  await setGuessWho(user.id, parsed.data);
  return NextResponse.json({ ok: true });
});

export const DELETE = audited(async function DELETE(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  noteAudit({ target: "guess_who", targetLabel: "Guess Who" });
  await resetGuessWho();
  return NextResponse.json({ ok: true });
});
