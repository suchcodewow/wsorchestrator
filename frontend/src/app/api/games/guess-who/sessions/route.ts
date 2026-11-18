/** Training → Games → Guess Who: open a game to the room by a code. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getGuessWho } from "@/lib/games/settings";
import { shareGame } from "@/lib/games/guess-who-sessions";
import { canManageTrainingSettings } from "@/lib/roles";

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const body = (await req.json().catch(() => null)) as { state?: unknown } | null;
  const settings = await getGuessWho();
  const game = await shareGame(user.id, settings.config, settings.updatedAt?.toISOString() ?? "defaults", body?.state);

  noteAudit({ target: game.code, targetLabel: `Guess Who ${game.code}` });
  return NextResponse.json(game, { status: 201 });
});
