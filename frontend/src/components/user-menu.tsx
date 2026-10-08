"use client";

/** The account menu, everywhere one is opened. */

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronsUpDown,
  Laptop,
  Loader2,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  Undo2,
  VenetianMask,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { useEmployeeSearch } from "@/components/employee-picker";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioIconItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEME_PREFERENCES, type ThemePreference } from "@/db/schema";
import type { BuildInfo } from "@/lib/build-info";
import { visibleSections } from "@/lib/nav";
import { accessBadges, canImpersonate, type Access } from "@/lib/roles";
import { applyTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { setThemePreference } from "@/lib/user-settings";

const SECTION_HEADING =
  "px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: LucideIcon }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System default", Icon: Laptop },
];

export type MenuVariant = "header" | "sidebar" | "rail";

const TRIGGER_CLASS: Record<MenuVariant, string> = {
  header:
    "flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
  sidebar:
    "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
  rail: "flex size-10 cursor-pointer items-center justify-center rounded-lg outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
};

/**
 * The hover text for the build line. The visible line is only the tag and a
 * rounded timestamp, so the tooltip carries what identifies the build to a
 * person: the exact instant and the commit subject it was cut from.
 */
function buildTitle(build: BuildInfo): string {
  if (!build.builtAt) return "Not a released build";

  const built = `Built ${build.builtAt} from ${build.tag}`;
  return build.message ? `${built}\n${build.message}` : built;
}

/** The administrator really signed in, while the menu's name is whom they view the app as. */
export type Impersonator = { name: string | null; email: string | null };

const IMPERSONATION_ERRORS: Record<string, string> = {
  not_found: "Not on the employee list.",
  self: "That is you.",
  platform_admin: "A platform administrator already sees everything.",
  impersonating: "Stop viewing as them first.",
};

/**
 * Starts or ends viewing as someone, then reloads the whole app as the new
 * person: every page is rendered for whoever the session is, and the page
 * an administrator was on may be one the employee cannot open.
 */
async function impersonate(email: string | null): Promise<string | null> {
  const res = await fetch("/api/me/impersonation", {
    method: email ? "POST" : "DELETE",
    headers: { "content-type": "application/json" },
    body: email ? JSON.stringify({ email }) : undefined,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return IMPERSONATION_ERRORS[body?.error ?? ""] ?? "Something went wrong.";
  }
  window.location.assign(email ? "/" : window.location.href);
  return null;
}

/** Finds an employee to view the app as. */
function ImpersonationPicker() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim();
  const { matches } = useEmployeeSearch(q, q.length > 0);

  async function choose(email: string) {
    setBusy(true);
    setError(await impersonate(email));
    setBusy(false);
  }

  return (
    <>
      <div className="px-2 pt-1 pb-1.5">
        <span className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <VenetianMask className="size-3.5" />
          View as an employee
        </span>
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError(null);
          }}
          // Typing belongs to the field, not the menu's jump-to-item search.
          onKeyDown={(e) => {
            if (e.key !== "Escape" && e.key !== "ArrowDown") e.stopPropagation();
          }}
          placeholder="Search by name or email"
          aria-label="Search employees to view the app as"
          autoComplete="off"
          spellCheck={false}
          className="h-8 text-sm"
        />
        {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
      </div>
      {q &&
        matches.slice(0, 6).map((e) => (
          <DropdownMenuItem
            key={e.email}
            disabled={busy}
            onSelect={(ev) => {
              ev.preventDefault();
              void choose(e.email);
            }}
            className="flex-col items-start gap-0"
          >
            <span className="truncate">{e.fullName}</span>
            <span className="truncate text-xs text-muted-foreground">{e.email}</span>
          </DropdownMenuItem>
        ))}
    </>
  );
}

/** Says whom the app is shown as, and ends it. */
function ImpersonationNotice({ impersonator, name }: { impersonator: Impersonator; name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <div className="mx-1 mb-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200">
        <span className="flex items-center gap-1.5 font-medium">
          <VenetianMask className="size-3.5 shrink-0" />
          <span className="truncate">Viewing as {name}</span>
        </span>
        <span className="mt-0.5 block truncate opacity-80">
          Signed in as {impersonator.name ?? impersonator.email}. Nothing can be changed.
        </span>
        {error && <span className="mt-0.5 block text-destructive">{error}</span>}
      </div>
      <DropdownMenuItem
        disabled={busy}
        onSelect={(ev) => {
          ev.preventDefault();
          setBusy(true);
          void impersonate(null).then((e) => {
            setError(e);
            setBusy(false);
          });
        }}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Undo2 />}
        Stop viewing as {name}
      </DropdownMenuItem>
    </>
  );
}

export function UserMenu({
  name,
  email,
  image,
  access,
  initialTheme,
  build,
  signOutAction,
  impersonator = null,
  accountOnly = false,
  variant = "header",
}: {
  name: string | null;
  email: string;
  image: string | null;
  access: Access;
  initialTheme: ThemePreference;
  build: BuildInfo;
  signOutAction: () => Promise<void>;
  impersonator?: Impersonator | null;
  accountOnly?: boolean;
  variant?: MenuVariant;
}) {
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [, startTransition] = useTransition();

  function chooseTheme(value: string) {
    if (!THEME_PREFERENCES.includes(value as ThemePreference)) return;
    const preference = value as ThemePreference;

    setTheme(preference);
    applyTheme(preference);
    startTransition(() => {
      void setThemePreference(preference);
    });
  }

  const badges = accessBadges(access);
  const sections = accountOnly ? [] : visibleSections(access);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={variant === "rail" ? (name ?? email) : undefined}
        className={cn(TRIGGER_CLASS[variant], impersonator && "ring-2 ring-amber-500/60")}
      >
        {variant === "header" && (
          <>
            <Avatar name={name} email={email} image={image} className="size-6 text-[11px]" />
            <span className="max-w-28 truncate sm:max-w-48">{name ?? email}</span>
            <ChevronDown className="size-4 shrink-0" />
          </>
        )}

        {variant === "rail" && <Avatar name={name} email={email} image={image} />}

        {variant === "sidebar" && (
          <>
            <Avatar name={name} email={email} image={image} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{name ?? email}</span>
              {name && (
                <span className="block truncate text-xs text-muted-foreground">{email}</span>
              )}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side={variant === "header" ? "bottom" : "right"}
        align="end"
        className="min-w-56"
      >
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate font-medium">{name ?? email}</span>
          {name && (
            <span className="block truncate text-xs text-muted-foreground">{email}</span>
          )}
          {badges.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {badges.map((badge) => (
                <span
                  key={badge}
                  className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand"
                >
                  <ShieldCheck className="size-3" />
                  {badge}
                </span>
              ))}
            </span>
          )}
        </DropdownMenuLabel>

        {impersonator && <ImpersonationNotice impersonator={impersonator} name={name ?? email} />}

        {sections.map((section) => (
          <Fragment key={section.heading}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className={SECTION_HEADING}>{section.heading}</DropdownMenuLabel>
            {section.items.map((item) => (
              <DropdownMenuItem key={item.href} asChild>
                <Link href={item.href}>
                  <item.Icon />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}

        <DropdownMenuSeparator />

        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <span className="text-xs text-muted-foreground">Appearance</span>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={chooseTheme}
            className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
          >
            {THEME_OPTIONS.map(({ value, label, Icon }) => (
              <DropdownMenuRadioIconItem key={value} value={value} aria-label={label} title={label}>
                <Icon />
              </DropdownMenuRadioIconItem>
            ))}
          </DropdownMenuRadioGroup>
        </div>

        {!impersonator && canImpersonate(access) && (
          <>
            <DropdownMenuSeparator />
            <ImpersonationPicker />
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => startTransition(() => void signOutAction())}>
          <LogOut />
          Sign out
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <div
          className="px-2 py-1 text-[11px] leading-tight text-muted-foreground"
          title={buildTitle(build)}
        >
          <span className="font-mono">{build.tag}</span>
          {build.builtAtLabel && <span className="mt-0.5 block">built {build.builtAtLabel}</span>}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
