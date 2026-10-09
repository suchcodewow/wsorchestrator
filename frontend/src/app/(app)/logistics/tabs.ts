/** The tabs across the top of Logistics. */

import { Gavel, Salad, UtensilsCrossed, type LucideIcon } from "lucide-react";

export type LogisticsTab = { href: string; label: string; Icon: LucideIcon };

export const LOGISTICS_TABS: LogisticsTab[] = [
  { href: "/logistics/guest-judges", label: "Guest judges", Icon: Gavel },
  { href: "/logistics/dietary", label: "Dietary needs", Icon: Salad },
  { href: "/logistics/food-orders", label: "Food orders", Icon: UtensilsCrossed },
];
