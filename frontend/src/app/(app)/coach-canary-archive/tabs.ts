/** The tabs across the top of Mimir. */

import { BookA, Library, Target } from "lucide-react";
import type { TabItem } from "@/components/tab-nav";

export const MIMIR_TABS: TabItem[] = [
  { href: "/coach-canary-archive/library", label: "Library", Icon: Library },
  { href: "/coach-canary-archive/glossary", label: "Glossary", Icon: BookA },
  { href: "/coach-canary-archive/progress", label: "Progress", Icon: Target },
];
