import { AtSign, FileCode2, KeySquare, type LucideIcon } from "lucide-react";

/**
 * The tabs across the top of the admin settings, in the order they are drawn.
 *
 * Plain data in a plain module, for the reason `me/tabs.ts` spells out: a server
 * component importing this from the `"use client"` component that draws the row
 * would get a client reference, not the array — and `/settings` reads `[0].href`
 * to decide where to land.
 *
 * The order is deliberate. Sign-in domains first because it is the setting that
 * decides who can have an account at all; the two Harness tabs after it, because
 * they only matter once there is somebody running workshops.
 */
export type SiteSettingsTab = {
  href: string;
  label: string;
  Icon: LucideIcon;
};

export const SITE_SETTINGS_TABS: SiteSettingsTab[] = [
  { href: "/settings/domains", label: "Sign-in domains", Icon: AtSign },
  { href: "/settings/org-secrets", label: "Org Secrets", Icon: KeySquare },
  { href: "/settings/templates", label: "Templates", Icon: FileCode2 },
];
