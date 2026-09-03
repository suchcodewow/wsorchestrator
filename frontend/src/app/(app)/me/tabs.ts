import { KeyRound, type LucideIcon } from "lucide-react";

/**
 * The tabs across the top of My settings, in the order they are drawn.
 *
 * A module of its own, not an export from `settings-tabs.tsx`, and for a reason
 * that is easy to trip over: everything a server component imports from a
 * `"use client"` module arrives as a client *reference* rather than as the value,
 * so `/me` reading `[0].href` from there got `undefined`. Plain data belongs in
 * plain modules, and both sides import this one.
 */
export type SettingsTab = {
  href: string;
  label: string;
  Icon: LucideIcon;
};

export const MY_SETTINGS_TABS: SettingsTab[] = [
  { href: "/me/tokens", label: "My tokens", Icon: KeyRound },
];
