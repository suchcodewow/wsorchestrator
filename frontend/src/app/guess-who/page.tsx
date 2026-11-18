/** Guess Who for reps: one fixed link to whichever game is on the main screen, with no sign-in. */

import type { Metadata } from "next";
import { getCurrentSharedGame } from "@/lib/games/guess-who-sessions";
import { RepBoard } from "./rep-board";

export const metadata: Metadata = {
  title: "Guess Who",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function GuessWhoJoinPage() {
  const game = await getCurrentSharedGame();
  return (
    <div className="min-h-screen bg-background px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <RepBoard initial={game} />
      </div>
    </div>
  );
}
