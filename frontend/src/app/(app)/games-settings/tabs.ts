/** The tabs across the top of Games settings: one per game. */

import { UserRoundSearch, type LucideIcon } from "lucide-react";

export type GamesSettingsTab = { href: string; label: string; Icon: LucideIcon };

export const GAMES_SETTINGS_TABS: GamesSettingsTab[] = [{ href: "/games-settings/guess-who", label: "Guess Who", Icon: UserRoundSearch }];
