/** The shared game reps reach at /guess-who: the one on the main screen, if any. */

import { NextResponse } from "next/server";
import { getCurrentSharedGame } from "@/lib/games/guess-who-sessions";

export async function GET() {
  const game = await getCurrentSharedGame();
  if (!game) return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(game, { headers: { "Cache-Control": "no-store" } });
}
