/** The facilitator's moves on a shared game: end a turn, guess, score, next round, start over. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { gameActionSchema } from "@/lib/games/guess-who-play";
import { normalizeCode, playSharedGame } from "@/lib/games/guess-who-sessions";
import { canManageTrainingSettings } from "@/lib/roles";

export const POST = audited(async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = gameActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const code = normalizeCode((await params).code);
  if (code) noteAudit({ target: code, targetLabel: `Guess Who ${code}` });
  const game = code ? await playSharedGame(code, parsed.data) : null;
  if (!game) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(game);
});
