/** One shared Guess Who game: read by every screen on it, ended by the facilitator. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { endSharedGame, getSharedGame, normalizeCode } from "@/lib/games/guess-who-sessions";
import { canManageTrainingSettings } from "@/lib/roles";

type Ctx = { params: Promise<{ code: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const code = normalizeCode((await params).code);
  const game = code ? await getSharedGame(code) : null;
  if (!game) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(game, { headers: { "Cache-Control": "no-store" } });
}

export const DELETE = audited(async function DELETE(req: Request, { params }: Ctx) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const code = normalizeCode((await params).code);
  if (code) noteAudit({ target: code, targetLabel: `Guess Who ${code}` });
  if (!code || !(await endSharedGame(code))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
