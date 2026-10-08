/** The tabs across the top of Mimir. */

import { BookA, Library, Target } from "lucide-react";
import type { TabItem } from "@/components/tab-nav";

export const MIMIR_TABS: TabItem[] = [
  { href: "/mimir/library", label: "Library", Icon: Library },
  { href: "/mimir/glossary", label: "Glossary", Icon: BookA },
  { href: "/mimir/progress", label: "Progress", Icon: Target },
];
