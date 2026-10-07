"use client";

/** Everyone with an account, and the controls that set their roles or delete them. */

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
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { Card, CardContent } from "@/components/ui/card";
import {
  ASSESSMENTS_ROLES,
  EVENT_ROLES,
  IRIS_ROLES,
  TRAINING_ROLES,
  type AssessmentsRole,
  type EventRole,
  type IrisRole,
  type TrainingRole,
} from "@/db/schema";
import {
  ASSESSMENTS_ROLE_DESCRIPTIONS,
  ASSESSMENTS_ROLE_LABELS,
  EVENT_ROLE_DESCRIPTIONS,
  EVENT_ROLE_LABELS,
  IRIS_ROLE_DESCRIPTIONS,
  IRIS_ROLE_LABELS,
  NO_ASSESSMENTS_ACCESS_LABEL,
  NO_IRIS_ACCESS_LABEL,
  NO_TRAINING_ACCESS_LABEL,
  PLATFORM_ADMIN_LABEL,
  TRAINING_ROLE_DESCRIPTIONS,
  TRAINING_ROLE_LABELS,
  asAssessmentsRole,
  asEventRole,
  asIrisRole,
  asTrainingRole,
  canDeleteUsers,
  canManageRoles,
  type Access,
  type Area,
} from "@/lib/roles";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { UserSort } from "@/lib/list-specs";
import { cn } from "@/lib/utils";
import { CreateInviteDialog } from "./create-invite-dialog";
import { DeleteUserButton } from "./delete-user-button";

type SiteUser = {
  id: string;
  name: string | null;
  email: string | null;
  eventRole: EventRole;
  trainingRole: TrainingRole | null;
  assessmentsRole: AssessmentsRole | null;
  irisRole: IrisRole | null;
  isPlatformAdmin: boolean;
  isBootstrapAdmin: boolean;
  eventCount: number;
};

type Roles = Pick<SiteUser, "eventRole" | "trainingRole" | "assessmentsRole" | "irisRole" | "isPlatformAdmin">;

type Change =
  | { area: "event"; role: EventRole }
  | { area: "training"; role: TrainingRole | null }
  | { area: "assessments"; role: AssessmentsRole | null }
  | { area: "iris"; role: IrisRole | null }
  | { area: "platform"; value: boolean };

const ERRORS: Record<string, string> = {
  self: "You can't change your own roles — ask another administrator.",
  not_found: "That account no longer exists.",
  forbidden: "Your own role changed — reload the page.",
  platform_target: "Only a platform administrator can change another platform administrator.",
  bootstrap:
    "That address is in SITE_ADMIN_EMAILS, which makes it a platform administrator on every sign-in.",
};

/** The training, eVals and Iris areas' radio value for "no role", which a radio group can't hold as null. */
const NO_TRAINING = "none";
const NO_ASSESSMENTS = "none";
const NO_IRIS = "none";

const EVENT_CHIP: Record<EventRole, string> = {
  none: "text-muted-foreground/70",
  contributor: "text-muted-foreground",
  operator: "text-muted-foreground",
  manager: "text-brand",
  administrator: "text-brand",
};

export function UsersTable({
  query,
  page,
  viewerId,
  viewerAccess,
  pendingAdmins,
}: {
  query: ListQuery<UserSort>;
  page: Page<SiteUser>;
  viewerId: string;
  viewerAccess: Access;
  pendingAdmins: string[];
}) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, Partial<Roles>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = page.rows;
  const sortProps = { sort: query.sort, dir: query.dir };

  const rolesOf = (u: SiteUser): Roles => ({
    eventRole: u.eventRole,
    trainingRole: u.trainingRole,
    assessmentsRole: u.assessmentsRole,
    irisRole: u.irisRole,
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
        : next.area === "training"
          ? { trainingRole: next.role }
          : next.area === "assessments"
            ? { assessmentsRole: next.role }
            : next.area === "iris"
              ? { irisRole: next.role }
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
        <TableSearch
          value={query.q}
          placeholder="Search by name or email"
          label="Search users by name or email"
        />

        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-240 text-sm">
              <thead>
                <tr className={HEADER_ROW}>
                  <SortHeader column="user" {...sortProps}>User</SortHeader>
                  <SortHeader column="eventRole" {...sortProps}>Event role</SortHeader>
                  <SortHeader column="trainingRole" {...sortProps}>Training role</SortHeader>
                  <SortHeader column="assessmentsRole" {...sortProps}>Assessments role</SortHeader>
                  <SortHeader column="irisRole" {...sortProps}>Iris role</SortHeader>
                  <SortHeader column="platform" {...sortProps}>Platform admin</SortHeader>
                  {viewerDeletes && (
                    <PlainHeader className="w-px">
                      <span className="sr-only">Delete</span>
                    </PlainHeader>
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
                      {query.q ? <>No one matches “{query.q}”.</> : "No one on this page."}
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
                        ) : editable(u, "training") ? (
                          <RoleMenu
                            heading="Training role"
                            value={roles.trainingRole ?? NO_TRAINING}
                            label={
                              roles.trainingRole
                                ? TRAINING_ROLE_LABELS[roles.trainingRole]
                                : NO_TRAINING_ACCESS_LABEL
                            }
                            chip={
                              roles.trainingRole === "administrator"
                                ? "text-brand"
                                : roles.trainingRole
                                  ? "text-muted-foreground"
                                  : "text-muted-foreground/70"
                            }
                            saving={saving === `${u.id}:training`}
                            options={[
                              {
                                value: NO_TRAINING,
                                label: NO_TRAINING_ACCESS_LABEL,
                                description: "Cannot see the training.",
                              },
                              ...TRAINING_ROLES.map((r) => ({
                                value: r,
                                label: TRAINING_ROLE_LABELS[r],
                                description: TRAINING_ROLE_DESCRIPTIONS[r],
                              })),
                            ]}
                            onChange={(v) => {
                              const role = v === NO_TRAINING ? null : asTrainingRole(v);
                              if (v !== NO_TRAINING && !role) return;
                              if (role !== roles.trainingRole) {
                                void change(u, { area: "training", role });
                              }
                            }}
                          />
                        ) : (
                          <ReadOnly title={readOnlyTitle}>
                            {roles.trainingRole
                              ? TRAINING_ROLE_LABELS[roles.trainingRole]
                              : NO_TRAINING_ACCESS_LABEL}
                          </ReadOnly>
                        )}
                      </td>

                      <td className="px-5 py-3">
                        {roles.isPlatformAdmin ? (
                          <ViaPlatform />
                        ) : editable(u, "assessments") ? (
                          <RoleMenu
                            heading="Assessments role"
                            value={roles.assessmentsRole ?? NO_ASSESSMENTS}
                            label={
                              roles.assessmentsRole
                                ? ASSESSMENTS_ROLE_LABELS[roles.assessmentsRole]
                                : NO_ASSESSMENTS_ACCESS_LABEL
                            }
                            chip={
                              roles.assessmentsRole === "administrator"
                                ? "text-brand"
                                : roles.assessmentsRole
                                  ? "text-muted-foreground"
                                  : "text-muted-foreground/70"
                            }
                            saving={saving === `${u.id}:assessments`}
                            options={[
                              {
                                value: NO_ASSESSMENTS,
                                label: NO_ASSESSMENTS_ACCESS_LABEL,
                                description: "Cannot see assessments.",
                              },
                              ...ASSESSMENTS_ROLES.map((r) => ({
                                value: r,
                                label: ASSESSMENTS_ROLE_LABELS[r],
                                description: ASSESSMENTS_ROLE_DESCRIPTIONS[r],
                              })),
                            ]}
                            onChange={(v) => {
                              const role = v === NO_ASSESSMENTS ? null : asAssessmentsRole(v);
                              if (v !== NO_ASSESSMENTS && !role) return;
                              if (role !== roles.assessmentsRole) {
                                void change(u, { area: "assessments", role });
                              }
                            }}
                          />
                        ) : (
                          <ReadOnly title={readOnlyTitle}>
                            {roles.assessmentsRole
                              ? ASSESSMENTS_ROLE_LABELS[roles.assessmentsRole]
                              : NO_ASSESSMENTS_ACCESS_LABEL}
                          </ReadOnly>
                        )}
                      </td>

                      <td className="px-5 py-3">
                        {roles.isPlatformAdmin ? (
                          <ViaPlatform />
                        ) : editable(u, "iris") ? (
                          <RoleMenu
                            heading="Iris role"
                            value={roles.irisRole ?? NO_IRIS}
                            label={
                              roles.irisRole
                                ? IRIS_ROLE_LABELS[roles.irisRole]
                                : NO_IRIS_ACCESS_LABEL
                            }
                            chip={
                              roles.irisRole === "administrator"
                                ? "text-brand"
                                : roles.irisRole
                                  ? "text-muted-foreground"
                                  : "text-muted-foreground/70"
                            }
                            saving={saving === `${u.id}:iris`}
                            options={[
                              {
                                value: NO_IRIS,
                                label: NO_IRIS_ACCESS_LABEL,
                                description: "Cannot see Iris.",
                              },
                              ...IRIS_ROLES.map((r) => ({
                                value: r,
                                label: IRIS_ROLE_LABELS[r],
                                description: IRIS_ROLE_DESCRIPTIONS[r],
                              })),
                            ]}
                            onChange={(v) => {
                              const role = v === NO_IRIS ? null : asIrisRole(v);
                              if (v !== NO_IRIS && !role) return;
                              if (role !== roles.irisRole) {
                                void change(u, { area: "iris", role });
                              }
                            }}
                          />
                        ) : (
                          <ReadOnly title={readOnlyTitle}>
                            {roles.irisRole
                              ? IRIS_ROLE_LABELS[roles.irisRole]
                              : NO_IRIS_ACCESS_LABEL}
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
          <div className="border-t empty:hidden">
            <Pager page={page} noun="users" />
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
