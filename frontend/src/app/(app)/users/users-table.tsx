"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronDown, Loader2, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent } from "@/components/ui/card";
import { SITE_ROLES, type SiteRole } from "@/db/schema";
import {
  SITE_ROLE_DESCRIPTIONS,
  SITE_ROLE_LABELS,
  asSiteRole,
} from "@/lib/roles";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

type SiteUser = {
  id: string;
  name: string | null;
  email: string | null;
  siteRole: SiteRole;
  eventCount: number;
};

const ERRORS: Record<string, string> = {
  self: "You can't change your own role — ask another administrator.",
  not_found: "That account no longer exists.",
  forbidden: "Your own role changed. Reload the page.",
};

/**
 * Tint for the role chip. Operator stays neutral: it is the default. A
 * contributor is dimmer still — it is the one role below that default, and it
 * grants less than signing in used to.
 */
const ROLE_CHIP: Record<SiteRole, string> = {
  contributor: "text-muted-foreground/70",
  operator: "text-muted-foreground",
  manager: "text-brand",
  administrator: "text-brand",
};

export function UsersTable({
  users,
  viewerId,
  pendingAdmins,
}: {
  users: SiteUser[];
  viewerId: string;
  /** `SITE_ADMIN_EMAILS` entries that have never signed in. */
  pendingAdmins: string[];
}) {
  const router = useRouter();
  // Optimistic role per user id, so the row updates the moment it is picked
  // and the whole table doesn't have to wait on a refresh to look right.
  const [roles, setRoles] = useState<Record<string, SiteRole>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roleOf = (u: SiteUser) => roles[u.id] ?? u.siteRole;

  async function change(user: SiteUser, value: string) {
    const role = asSiteRole(value);
    if (!role || role === roleOf(user)) return;

    const previous = roleOf(user);
    setRoles((r) => ({ ...r, [user.id]: role }));
    setSaving(user.id);
    setError(null);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          ERRORS[body?.error] ?? `Could not save (${res.status})`,
        );
      }
      // Their next page load reads the new role; nothing on this one does.
      router.refresh();
    } catch (err) {
      setRoles((r) => ({ ...r, [user.id]: previous }));
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(null);
    }
  }

  return (
    <motion.div
      variants={staggerParent(0.05)}
      initial="hidden"
      animate="show"
      className="space-y-8"
    >
      <motion.div variants={riseChild} className="space-y-1.5">
        <h1 className="text-3xl font-medium tracking-tight">Users</h1>
        <p className="text-muted-foreground">
          Everyone who has signed in, and what they are allowed to do.
        </p>
      </motion.div>

      <motion.div variants={riseChild}>
        <Card>
          <CardContent className="grid gap-2 py-5 text-sm">
            {SITE_ROLES.map((role) => (
              <div key={role} className="flex flex-wrap gap-x-2.5">
                <span className="w-28 shrink-0 font-medium">
                  {SITE_ROLE_LABELS[role]}
                </span>
                <span className="text-muted-foreground">
                  {SITE_ROLE_DESCRIPTIONS[role]}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </motion.div>

      {pendingAdmins.length > 0 && (
        <motion.div variants={riseChild}>
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="py-4 text-sm">
              <span className="font-medium">Waiting on a first sign-in:</span>{" "}
              <span className="font-mono">{pendingAdmins.join(", ")}</span>.
              These are listed in <code>SITE_ADMIN_EMAILS</code> but have no
              account here yet — they become administrators when they sign in.
            </CardContent>
          </Card>
        </motion.div>
      )}

      {error && (
        <motion.p variants={riseChild} className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div
        variants={riseChild}
        className="overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        {/*
          The card keeps `overflow-hidden` for its rounded corners; the scroller
          is this inner box. Without it a narrow viewport had the card clip the
          table's right-hand columns with no way to reach them — and the pane is
          now 16rem narrower whenever the sidebar is expanded, so "narrow" starts
          on a laptop rather than only on a phone.
        */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-136 text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">User</th>
                <th className="px-5 py-2.5 font-medium">Events</th>
                <th className="px-5 py-2.5 font-medium">Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const role = roleOf(u);
                const isSelf = u.id === viewerId;

                return (
                  <tr
                    key={u.id}
                    className="border-b transition-colors last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-5 py-3">
                      <span className="block font-medium">
                        {u.name ?? u.email}
                        {isSelf && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            you
                          </span>
                        )}
                      </span>
                      {u.name && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {u.email}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground tnum">
                      {u.eventCount}
                    </td>
                    <td className="px-5 py-3">
                      {isSelf ? (
                        // An administrator demoting themselves could leave the
                        // site with nobody able to grant the role back.
                        <span
                          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
                          title="Another administrator has to change your role"
                        >
                          <ShieldCheck className="size-3.5" />
                          {SITE_ROLE_LABELS[role]}
                        </span>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            disabled={saving === u.id}
                            className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
                          >
                            <span className={cn("font-medium", ROLE_CHIP[role])}>
                              {SITE_ROLE_LABELS[role]}
                            </span>
                            {saving === u.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <ChevronDown className="size-3.5 text-muted-foreground" />
                            )}
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-56">
                            <DropdownMenuLabel className="text-xs text-muted-foreground">
                              Role
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuRadioGroup
                              value={role}
                              onValueChange={(v) => change(u, v)}
                            >
                              {SITE_ROLES.map((r) => (
                                <DropdownMenuRadioItem key={r} value={r}>
                                  <span className="grid gap-0.5">
                                    <span>{SITE_ROLE_LABELS[r]}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {SITE_ROLE_DESCRIPTIONS[r]}
                                    </span>
                                  </span>
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>
    </motion.div>
  );
}
