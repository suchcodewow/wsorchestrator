/** Guess Who, SDLC edition: two teams, two boards, one mystery tool each. */

import { WideView } from "@/components/wide-view";
import { getGuessWho } from "@/lib/games/settings";
import { GuessWhoGame } from "./guess-who-game";

export const dynamic = "force-dynamic";

export default async function GuessWhoPage() {
  const settings = await getGuessWho();
  return (
    <WideView>
      <GuessWhoGame config={settings.config} version={settings.updatedAt?.toISOString() ?? "defaults"} />
    </WideView>
  );
}
