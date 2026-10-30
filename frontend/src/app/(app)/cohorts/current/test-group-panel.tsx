"use client";

/**
 * The cohort test group, at the top of the Current tab. A platform
 * administrator switches it on, picks the people in it and types the suffix
 * its channels and meetings carry; while it is on, everyone here is told, and
 * sees who is in it. Turning it off archives what it made in Slack and
 * cancels its invites, which the server does before it switches off.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert, X } from "lucide-react";
import { EmployeePicker } from "@/components/employee-picker";
import { PillSwitch } from "@/components/pill-switch";
import { Input } from "@/components/ui/input";
import {
  TEST_GROUP_STAGES,
  testGroupSlug,
  type TestGroupMember,
  type TestGroupStage,
} from "@/lib/cohorts/test-group-plan";

const STAGE_LABELS: Record<TestGroupStage, string> = {
  bootcamp: "Bootcamp",
  intermediate: "Intermediate",
  both: "Both",
};

function StageSelect({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: TestGroupStage;
  disabled: boolean;
  onChange: (stage: TestGroupStage) => void;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as TestGroupStage)}
      className="h-8 cursor-pointer rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {TEST_GROUP_STAGES.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

type Group = { on: boolean; suffix: string; members: TestGroupMember[] };

const ERRORS: Record<string, string> = {
  invalid: "Pick someone from the list.",
  suffix_required: "Type a suffix first.",
  members_required: "Add at least one person first.",
  suffix_locked: "Turn the test group off to change its suffix.",
  forbidden: "Only a platform administrator can change the test group.",
};

export function TestGroupPanel({
  group,
  canManage,
}: {
  group: Group;
  canManage: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(false);
  const [suffix, setSuffix] = useState(group.suffix);
  const [newStage, setNewStage] = useState<TestGroupStage>("both");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);

  const editing = canManage && (group.on || draft);
  if (!group.on && !editing && !canManage) return null;

  async function save(change: Partial<Group>): Promise<boolean> {
    setBusy(true);
    setError(null);
    setFailures([]);
    try {
      const res = await fetch("/api/cohorts/test-group", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          body?.error === "teardown_failed"
            ? "The test group is still on: some of what it made could not be removed. Try again."
            : (ERRORS[body?.error ?? ""] ?? `Could not save (${res.status}).`),
        );
        setFailures(body?.failures ?? []);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Saves a change; if the group was being set up and now has a suffix and people, switches it on with it. */
  async function saveAndEnable(change: Partial<Group>) {
    const members = change.members ?? group.members;
    const slug = change.suffix ?? group.suffix;
    const ready = draft && !group.on && members.length > 0 && slug !== "";
    const ok = await save(ready ? { ...change, on: true } : change);
    if (ok && ready) setDraft(false);
    return ok;
  }

  async function toggle(on: boolean) {
    if (on) {
      setDraft(true);
      // Already has a suffix and people: on at once. Otherwise on once it does.
      if (group.members.length > 0 && group.suffix && (await save({ on: true }))) setDraft(false);
      return;
    }
    if (!group.on) {
      setDraft(false);
      return;
    }
    if (
      !window.confirm(
        "Turn the test group off? Its Slack channels are archived and its calendar invites cancelled.",
      )
    )
      return;
    if (await save({ on: false })) setDraft(false);
  }

  const slug = testGroupSlug(suffix);

  return (
    <div className="space-y-3">
      {group.on && (
        <div
          role="alert"
          className="flex gap-3 rounded-2xl border border-amber-500/50 bg-amber-500/10 px-5 py-4 text-sm text-amber-900 dark:text-amber-200"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1.5">
            <p className="font-medium">
              The test group is enabled. Contact a platform administrator to
              turn it off.
            </p>
            <p>
              Slack, calendar invites and reminders for the cohort go to these{" "}
              {group.members.length}{" "}
              {group.members.length === 1 ? "person" : "people"} instead, under
              names ending <span className="font-mono">-{group.suffix}</span>:
            </p>
            <ul className="list-disc pl-5">
              {group.members.map((m) => (
                <li key={m.email}>
                  {m.fullName ? `${m.fullName} ` : ""}
                  <span className="opacity-80">{m.email}</span>
                  {" · "}
                  {STAGE_LABELS[m.stage]}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {canManage && (
        <div className="space-y-4 rounded-2xl border bg-card px-5 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <PillSwitch
              label="Use test group"
              on={group.on || draft}
              onChange={toggle}
              disabled={busy}
            />
            {busy && (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {editing && (
            <>
              <div className="max-w-md space-y-1.5">
                <label
                  htmlFor="test-group-suffix"
                  className="text-sm font-medium"
                >
                  Suffix
                </label>
                <Input
                  id="test-group-suffix"
                  value={suffix}
                  disabled={busy || group.on}
                  placeholder="smoke-test"
                  onChange={(e) => setSuffix(e.target.value)}
                  onBlur={() => {
                    if (!group.on && slug !== group.suffix)
                      void saveAndEnable({ suffix });
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {group.on
                    ? "Turn the test group off to change its suffix."
                    : slug
                      ? `Channels end in -${slug}, such as sales-bootcamp-nov-2026-${slug}; meetings are titled [${slug}].`
                      : "Added to every channel and meeting name the test group makes."}
                </p>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <label htmlFor="test-group-new-stage" className="font-medium">
                  New people join
                </label>
                <StageSelect
                  id="test-group-new-stage"
                  label="Stage for people you add"
                  value={newStage}
                  disabled={busy}
                  onChange={setNewStage}
                />
              </div>

              <EmployeePicker
                id="test-group-member"
                label="Add to the test group"
                placeholder="Search employees by name"
                busy={busy}
                onAdd={async (email, fullName) =>
                  saveAndEnable({
                    members: [
                      ...group.members,
                      { email, fullName: fullName ?? "", stage: newStage },
                    ],
                  })
                }
              />

              {group.members.length > 0 ? (
                <ul className="divide-y rounded-xl border text-sm">
                  {group.members.map((m) => (
                    <li
                      key={m.email}
                      className="flex items-center justify-between gap-3 px-4 py-2"
                    >
                      <span>
                        {m.fullName && (
                          <span className="font-medium">{m.fullName} </span>
                        )}
                        <span className="text-muted-foreground">{m.email}</span>
                      </span>
                      <StageSelect
                        id={`stage-${m.email}`}
                        label={`Stage for ${m.fullName || m.email}`}
                        value={m.stage}
                        disabled={busy}
                        onChange={(stage) =>
                          void saveAndEnable({
                            members: group.members.map((x) =>
                              x.email === m.email ? { ...x, stage } : x,
                            ),
                          })
                        }
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${m.fullName || m.email}`}
                        disabled={
                          busy || (group.on && group.members.length === 1)
                        }
                        title={
                          group.on && group.members.length === 1
                            ? "Turn the test group off to remove the last person."
                            : undefined
                        }
                        onClick={() =>
                          void saveAndEnable({
                            members: group.members.filter(
                              (x) => x.email !== m.email,
                            ),
                          })
                        }
                        className="cursor-pointer rounded-md p-1 text-muted-foreground outline-none hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No one is in the test group yet.
                </p>
              )}
            </>
          )}

          {error && (
            <div role="alert" className="space-y-1 text-sm text-destructive">
              <p>{error}</p>
              {failures.length > 0 && (
                <ul className="list-disc pl-5">
                  {failures.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
