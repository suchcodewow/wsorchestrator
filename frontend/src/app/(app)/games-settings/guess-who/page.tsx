/** The Guess Who tab: the tool cards on the board, each round's mystery tools, and the question cap. */

import { getGuessWho } from "@/lib/games/settings";
import { GuessWhoSettingsForm } from "./guess-who-settings";

export default async function GuessWhoSettingsPage() {
  const settings = await getGuessWho();
  return (
    <GuessWhoSettingsForm
      config={settings.config}
      updatedAt={settings.updatedAt?.toISOString() ?? null}
      updatedBy={settings.updatedBy}
    />
  );
}
