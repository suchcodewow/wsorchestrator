/** The tabs across the top of Iris. Takers see none; Iris administrators see all three. */

import { FileQuestion, ListChecks, UsersRound } from "lucide-react";
import type { TabItem } from "@/components/tab-nav";

export const IRIS_TABS: TabItem[] = [
  { href: "/iris/tests", label: "Tests", Icon: ListChecks },
  { href: "/iris/cohort", label: "Cohort", Icon: UsersRound },
  { href: "/iris/questions", label: "Questions", Icon: FileQuestion },
];
