/** The tabs across the top of Games: one per game. */

import { UserRoundSearch, type LucideIcon } from "lucide-react";

export type GamesTab = { href: string; label: string; Icon: LucideIcon };

export const GAMES_TABS: GamesTab[] = [{ href: "/games/guess-who", label: "Guess Who", Icon: UserRoundSearch }];
