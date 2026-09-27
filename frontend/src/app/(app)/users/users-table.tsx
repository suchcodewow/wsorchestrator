"use client";

/** Everyone with an account, and the controls that set their roles. */

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
import {
  EVENT_ROLES,
  SCHEDULER_ROLES,
  type EventRole,
  type SchedulerRole,
} from "@/db/schema";
import {
  EVENT_ROLE_DESCRIPTIONS,
  EVENT_ROLE_LABELS,
  NO_SCHEDULER_ACCESS_LABEL,
  PLATFORM_ADMIN_DESCRIPTION,
  PLATFORM_ADMIN_LABEL,
  SCHEDULER_ROLE_DESCRIPTIONS,
  SCHEDULER_ROLE_LABELS,
  asEventRole,
  asSchedulerRole,
  canManageRoles,
  type Access,
  type Area,
} from "@/lib/roles";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

type SiteUser = {
  id: string;
  name: string | null;
  email: string | null;
  eventRole: EventRole;
  schedulerRole: SchedulerRole | null;
  isPlatformAdmin: boolean;
  isBootstrapAdmin: boolean;
  eventCount: number;
};

type Roles = Pick<SiteUser, "eventRole" | "schedulerRole" | "isPlatformAdmin">;

type Change =
  | { area: "event"; role: EventRole }
  | { area: "scheduler"; role: SchedulerRole | null }
  | { area: "platform"; value: boolean };

const ERRORS: Record<string, string> = {
  self: "You can't change your own roles — ask another administrator.",
  not_found: "That account no longer exists.",
  forbidden: "Your own role changed — reload the page.",
  platform_target: "Only a platform administrator can change another platform administrator.",
  bootstrap:
    "That address is in SITE_ADMIN_EMAILS, which makes it a platform administrator on every sign-in.",
};

/** The scheduler's radio value for "no role", which a radio group can't hold as null. */
const NO_SCHEDULER = "none";

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

  const rolesOf = (u: SiteUser): Roles => ({
    eventRole: u.eventRole,
    schedulerRole: u.schedulerRole,
    isPlatformAdmin: u.isPlatformAdmin,
    ...edits[u.id],
  });

  const viewerIsPlatform = canManageRoles(viewerAccess, "platform");

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
      <motion.div variants={riseChild} className="space-y-1.5">
        <h1 className="text-3xl font-medium tracking-tight">Users</h1>
        <p className="text-muted-foreground">
          Everyone who has signed in, and what they are allowed to do in each
          area. Each area&apos;s administrators set its roles.
        </p>
      </motion.div>

      <motion.div variants={riseChild}>
        <Card>
          <CardContent className="grid gap-5 py-5 text-sm">
            <Legend
              heading="Events"
              rows={EVENT_ROLES.map((r) => [EVENT_ROLE_LABELS[r], EVENT_ROLE_DESCRIPTIONS[r]])}
            />
            <Legend
              heading="Scheduler"
              rows={SCHEDULER_ROLES.map((r) => [
                SCHEDULER_ROLE_LABELS[r],
                SCHEDULER_ROLE_DESCRIPTIONS[r],
              ])}
            />
            <Legend
              heading="Platform"
              rows={[[PLATFORM_ADMIN_LABEL, PLATFORM_ADMIN_DESCRIPTION]]}
            />
          </CardContent>
        </Card>
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

      <motion.div
        variants={riseChild}
        className="overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-176 text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">User</th>
                <th className="px-5 py-2.5 font-medium">Events</th>
                <th className="px-5 py-2.5 font-medium">Event role</th>
                <th className="px-5 py-2.5 font-medium">Scheduler role</th>
                <th className="px-5 py-2.5 font-medium">Platform admin</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
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

function Legend({ heading, rows }: { heading: string; rows: [string, string][] }) {
  return (
    <div className="grid gap-2">
      <h2 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {heading}
      </h2>
      {rows.map(([label, description]) => (
        <div key={label} className="flex flex-wrap gap-x-2.5">
          <span className="w-44 shrink-0 font-medium">{label}</span>
          <span className="text-muted-foreground">{description}</span>
        </div>
      ))}
    </div>
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
