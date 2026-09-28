"use client";

/** Everyone with an account, and the controls that set their roles or delete them. */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronDown, Loader2, Search, ShieldCheck } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  EVALS_ROLES,
  EVENT_ROLES,
  SCHEDULER_ROLES,
  type EvalsRole,
  type EventRole,
  type SchedulerRole,
} from "@/db/schema";
import {
  EVALS_ROLE_DESCRIPTIONS,
  EVALS_ROLE_LABELS,
  EVENT_ROLE_DESCRIPTIONS,
  EVENT_ROLE_LABELS,
  NO_EVALS_ACCESS_LABEL,
  NO_SCHEDULER_ACCESS_LABEL,
  PLATFORM_ADMIN_LABEL,
  SCHEDULER_ROLE_DESCRIPTIONS,
  SCHEDULER_ROLE_LABELS,
  asEvalsRole,
  asEventRole,
  asSchedulerRole,
  canDeleteUsers,
  canManageRoles,
  type Access,
  type Area,
} from "@/lib/roles";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { CreateInviteDialog } from "./create-invite-dialog";
import { DeleteUserButton } from "./delete-user-button";

type SiteUser = {
  id: string;
  name: string | null;
  email: string | null;
  eventRole: EventRole;
  schedulerRole: SchedulerRole | null;
  evalsRole: EvalsRole | null;
  isPlatformAdmin: boolean;
  isBootstrapAdmin: boolean;
  eventCount: number;
};

type Roles = Pick<SiteUser, "eventRole" | "schedulerRole" | "evalsRole" | "isPlatformAdmin">;

type Change =
  | { area: "event"; role: EventRole }
  | { area: "scheduler"; role: SchedulerRole | null }
  | { area: "evals"; role: EvalsRole | null }
  | { area: "platform"; value: boolean };

const ERRORS: Record<string, string> = {
  self: "You can't change your own roles — ask another administrator.",
  not_found: "That account no longer exists.",
  forbidden: "Your own role changed — reload the page.",
  platform_target: "Only a platform administrator can change another platform administrator.",
  bootstrap:
    "That address is in SITE_ADMIN_EMAILS, which makes it a platform administrator on every sign-in.",
};

/** The scheduler's and eVals' radio value for "no role", which a radio group can't hold as null. */
const NO_SCHEDULER = "none";
const NO_EVALS = "none";

const EVENT_CHIP: Record<EventRole, string> = {
  none: "text-muted-foreground/70",
  contributor: "text-muted-foreground",
  operator: "text-muted-foreground",
  manager: "text-brand",
  administrator: "text-brand",
};

export function UsersTable({
  users,
  viewerId,
  viewerAccess,
  pendingAdmins,
}: {
  users: SiteUser[];
  viewerId: string;
  viewerAccess: Access;
  pendingAdmins: string[];
}) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, Partial<Roles>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q),
    );
  }, [users, query]);

  const rolesOf = (u: SiteUser): Roles => ({
    eventRole: u.eventRole,
    schedulerRole: u.schedulerRole,
    evalsRole: u.evalsRole,
    isPlatformAdmin: u.isPlatformAdmin,
    ...edits[u.id],
  });

  const viewerIsPlatform = canManageRoles(viewerAccess, "platform");
  const viewerDeletes = canDeleteUsers(viewerAccess);

  /** Why `user` can't be deleted, mirroring the refusals `deleteUser` makes. */
  function deleteBlockedBy(user: SiteUser): string | null {
    if (user.id === viewerId) return "You can't delete your own account";
    if (user.isBootstrapAdmin) return "Listed in SITE_ADMIN_EMAILS, so it would come straight back";
    if (user.eventCount > 0) {
      return `Owns ${user.eventCount} event${user.eventCount === 1 ? "" : "s"} — delete those first`;
    }
    return null;
  }

  /** Whether the viewer may change `user`'s role in `area` at all. */
  function editable(user: SiteUser, area: Area | "platform"): boolean {
    if (user.id === viewerId) return false;
    if (!canManageRoles(viewerAccess, area)) return false;
    return !rolesOf(user).isPlatformAdmin || viewerIsPlatform;
  }

  async function change(user: SiteUser, next: Change) {
    const patch: Partial<Roles> =
      next.area === "event"
        ? { eventRole: next.role }
        : next.area === "scheduler"
          ? { schedulerRole: next.role }
          : next.area === "evals"
            ? { evalsRole: next.role }
            : { isPlatformAdmin: next.value };

    const previous = edits[user.id];
    setEdits((e) => ({ ...e, [user.id]: { ...e[user.id], ...patch } }));
    setSaving(`${user.id}:${next.area}`);
    setError(null);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          ERRORS[body?.error] ?? `Could not save (${res.status})`,
        );
      }
      router.refresh();
    } catch (err) {
      setEdits((e) => ({ ...e, [user.id]: previous ?? {} }));
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
      <motion.div
        variants={riseChild}
        className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <h1 className="text-3xl font-medium tracking-tight">Manage users</h1>
        <CreateInviteDialog viewerAccess={viewerAccess} />
      </motion.div>

      {pendingAdmins.length > 0 && (
        <motion.div variants={riseChild}>
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="py-4 text-sm">
              <span className="font-medium">Waiting on a first sign-in:</span>{" "}
              <span className="font-mono">{pendingAdmins.join(", ")}</span> —
              listed in <code>SITE_ADMIN_EMAILS</code> and made platform
              administrators once they sign in.
            </CardContent>
          </Card>
        </motion.div>
      )}

      {error && (
        <motion.p variants={riseChild} className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild} className="space-y-3">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search users by name or email"
            className="pl-9"
          />
        </div>

        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-220 text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">User</th>
                  <th className="px-5 py-2.5 font-medium">Events</th>
                  <th className="px-5 py-2.5 font-medium">Event role</th>
                  <th className="px-5 py-2.5 font-medium">Scheduler role</th>
                  <th className="px-5 py-2.5 font-medium">eVals role</th>
                  <th className="px-5 py-2.5 font-medium">Platform admin</th>
                  {viewerDeletes && (
                    <th className="w-px px-5 py-2.5">
                      <span className="sr-only">Delete</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td
                      colSpan={viewerDeletes ? 7 : 6}
                      className="px-5 py-8 text-center text-muted-foreground"
                    >
                      No one matches “{query.trim()}”.
                    </td>
                  </tr>
                )}
                {shown.map((u) => {
                  const roles = rolesOf(u);
                  const isSelf = u.id === viewerId;
                  const readOnlyTitle = isSelf
                    ? "Another administrator has to change your roles"
                    : roles.isPlatformAdmin && !viewerIsPlatform
                      ? "Only a platform administrator can change this account"
                      : "You don't administer this area";

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
                        {roles.isPlatformAdmin ? (
                          <ViaPlatform />
                        ) : editable(u, "event") ? (
                          <RoleMenu
                            heading="Event role"
                            value={roles.eventRole}
                            label={EVENT_ROLE_LABELS[roles.eventRole]}
                            chip={EVENT_CHIP[roles.eventRole]}
                            saving={saving === `${u.id}:event`}
                            options={EVENT_ROLES.map((r) => ({
                              value: r,
                              label: EVENT_ROLE_LABELS[r],
                              description: EVENT_ROLE_DESCRIPTIONS[r],
                            }))}
                            onChange={(v) => {
                              const role = asEventRole(v);
                              if (role && role !== roles.eventRole) {
                                void change(u, { area: "event", role });
                              }
                            }}
                          />
                        ) : (
                          <ReadOnly title={readOnlyTitle}>
                            {EVENT_ROLE_LABELS[roles.eventRole]}
                          </ReadOnly>
                        )}
                      </td>

                      <td className="px-5 py-3">
                        {roles.isPlatformAdmin ? (
                          <ViaPlatform />
                        ) : editable(u, "scheduler") ? (
                          <RoleMenu
                            heading="Scheduler role"
                            value={roles.schedulerRole ?? NO_SCHEDULER}
                            label={
                              roles.schedulerRole
                                ? SCHEDULER_ROLE_LABELS[roles.schedulerRole]
                                : NO_SCHEDULER_ACCESS_LABEL
                            }
                            chip={
                              roles.schedulerRole === "administrator"
                                ? "text-brand"
                                : roles.schedulerRole
                                  ? "text-muted-foreground"
                                  : "text-muted-foreground/70"
                            }
                            saving={saving === `${u.id}:scheduler`}
                            options={[
                              {
                                value: NO_SCHEDULER,
                                label: NO_SCHEDULER_ACCESS_LABEL,
                                description: "Cannot see the scheduler.",
                              },
                              ...SCHEDULER_ROLES.map((r) => ({
                                value: r,
                                label: SCHEDULER_ROLE_LABELS[r],
                                description: SCHEDULER_ROLE_DESCRIPTIONS[r],
                              })),
                            ]}
                            onChange={(v) => {
                              const role = v === NO_SCHEDULER ? null : asSchedulerRole(v);
                              if (v !== NO_SCHEDULER && !role) return;
                              if (role !== roles.schedulerRole) {
                                void change(u, { area: "scheduler", role });
                              }
                            }}
                          />
                        ) : (
                          <ReadOnly title={readOnlyTitle}>
                            {roles.schedulerRole
                              ? SCHEDULER_ROLE_LABELS[roles.schedulerRole]
                              : NO_SCHEDULER_ACCESS_LABEL}
                          </ReadOnly>
                        )}
                      </td>

                      <td className="px-5 py-3">
                        {roles.isPlatformAdmin ? (
                          <ViaPlatform />
                        ) : editable(u, "evals") ? (
                          <RoleMenu
                            heading="eVals role"
                            value={roles.evalsRole ?? NO_EVALS}
                            label={
                              roles.evalsRole
                                ? EVALS_ROLE_LABELS[roles.evalsRole]
                                : NO_EVALS_ACCESS_LABEL
                            }
                            chip={
                              roles.evalsRole === "administrator"
                                ? "text-brand"
                                : roles.evalsRole
                                  ? "text-muted-foreground"
                                  : "text-muted-foreground/70"
                            }
                            saving={saving === `${u.id}:evals`}
                            options={[
                              {
                                value: NO_EVALS,
                                label: NO_EVALS_ACCESS_LABEL,
                                description: "Cannot see eVals.",
                              },
                              ...EVALS_ROLES.map((r) => ({
                                value: r,
                                label: EVALS_ROLE_LABELS[r],
                                description: EVALS_ROLE_DESCRIPTIONS[r],
                              })),
                            ]}
                            onChange={(v) => {
                              const role = v === NO_EVALS ? null : asEvalsRole(v);
                              if (v !== NO_EVALS && !role) return;
                              if (role !== roles.evalsRole) {
                                void change(u, { area: "evals", role });
                              }
                            }}
                          />
                        ) : (
                          <ReadOnly title={readOnlyTitle}>
                            {roles.evalsRole
                              ? EVALS_ROLE_LABELS[roles.evalsRole]
                              : NO_EVALS_ACCESS_LABEL}
                          </ReadOnly>
                        )}
                      </td>

                      <td className="px-5 py-3">
                        <PlatformCheckbox
                          checked={roles.isPlatformAdmin}
                          saving={saving === `${u.id}:platform`}
                          disabled={
                            !editable(u, "platform") ||
                            (roles.isPlatformAdmin && u.isBootstrapAdmin)
                          }
                          title={
                            u.isBootstrapAdmin && roles.isPlatformAdmin
                              ? "Listed in SITE_ADMIN_EMAILS"
                              : !editable(u, "platform")
                                ? isSelf
                                  ? "Another platform administrator has to change this"
                                  : "Only a platform administrator can change this"
                                : undefined
                          }
                          onChange={(value) => void change(u, { area: "platform", value })}
                        />
                      </td>

                      {viewerDeletes && (
                        <td className="px-3 py-3 text-right">
                          <DeleteUserButton user={u} blockedBy={deleteBlockedBy(u)} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ReadOnly({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
      title={title}
    >
      <ShieldCheck className="size-3.5" />
      {children}
    </span>
  );
}

function ViaPlatform() {
  return (
    <span
      className="text-sm font-medium text-brand"
      title="A platform administrator is an administrator in every area"
    >
      Administrator
    </span>
  );
}

function RoleMenu({
  heading,
  value,
  label,
  chip,
  saving,
  options,
  onChange,
}: {
  heading: string;
  value: string;
  label: string;
  chip: string;
  saving: boolean;
  options: { value: string; label: string; description: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={saving}
        className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
      >
        <span className={cn("font-medium", chip)}>{label}</span>
        {saving ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {heading}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              <span className="grid gap-0.5">
                <span>{o.label}</span>
                <span className="text-xs text-muted-foreground">{o.description}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PlatformCheckbox({
  checked,
  saving,
  disabled,
  title,
  onChange,
}: {
  checked: boolean;
  saving: boolean;
  disabled: boolean;
  title?: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      )}
      title={title}
    >
      <input
        type="checkbox"
        className="size-4 accent-brand"
        checked={checked}
        disabled={disabled || saving}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={PLATFORM_ADMIN_LABEL}
      />
      {saving && <Loader2 className="size-3.5 animate-spin" />}
    </label>
  );
}
