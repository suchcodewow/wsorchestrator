/** A rep knocks a card down on their team's board, or stands it back up. Anyone with the code may. */

import { NextResponse } from "next/server";
import { audited } from "@/lib/audit";
import { flipSchema } from "@/lib/games/guess-who-play";
import { normalizeCode, playSharedGame } from "@/lib/games/guess-who-sessions";

export const POST = audited(async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const parsed = flipSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const code = normalizeCode((await params).code);
  const { team, tool, down } = parsed.data;
  const game = code ? await playSharedGame(code, { type: "flip", team, id: tool, down }) : null;
  if (!game) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(game);
});
