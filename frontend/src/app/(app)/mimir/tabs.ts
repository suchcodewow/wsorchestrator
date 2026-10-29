/** The tabs across the top of Mimir. */

import { GitPullRequest, Map as MapIcon, MessagesSquare } from "lucide-react";
import type { TabItem } from "@/components/tab-nav";

export const MIMIR_TABS: TabItem[] = [
  { href: "/mimir/chat", label: "Chat", Icon: MessagesSquare },
  { href: "/mimir/map", label: "Map", Icon: MapIcon },
  { href: "/mimir/code-lab", label: "Code Lab", Icon: GitPullRequest },
];
