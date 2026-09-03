"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  DatabaseBackup,
  Loader2,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

type BackupRun = {
  id: string;
  type: string;
  status: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  description: string | null;
  error: string | null;
};

const UNAVAILABLE: Record<string, string> = {
  not_configured:
    "This deployment has no Cloud SQL instance configured, so there is nothing to list. Expected in local development; in production it means GCP_ADMIN_PROJECT_ID or CLOUD_SQL_INSTANCE is unset.",
  permission_denied:
    "The app's service account is not allowed to read backups. It needs roles/cloudsql.editor — apply the Terraform in infra/admin.",
  unavailable: "Could not reach the Cloud SQL API. Try again in a moment.",
};

const when = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

const format = (iso: string | null) =>
  iso ? when.format(new Date(iso)) : "—";

/** How old the most recent successful backup is, in plain words. */
function freshness(iso: string | null): { text: string; stale: boolean } | null {
  if (!iso) return null;
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return { text: "less than an hour ago", stale: false };
  if (hours < 24) {
    const h = Math.round(hours);
    return { text: `${h} hour${h === 1 ? "" : "s"} ago`, stale: false };
  }
  const days = Math.round(hours / 24);
  // Daily backups: anything past ~two days means the schedule is not running.
  return { text: `${days} day${days === 1 ? "" : "s"} ago`, stale: hours > 48 };
}

function StatusChip({ status }: { status: string }) {
  const done = status === "SUCCESSFUL";
  const failed = status === "FAILED";
  const Icon = done ? CheckCircle2 : failed ? XCircle : Clock;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        done && "text-brand",
        failed && "text-destructive",
        !done && !failed && "text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {status.toLowerCase().replace(/_/g, " ")}
    </span>
  );
}

export function BackupsTable({
  instance,
  project,
  initial,
  error,
}: {
  instance: string | null;
  project: string | null;
  initial: BackupRun[];
  error: string | null;
}) {
  const router = useRouter();
  const [backups, setBackups] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);

  // The backup the restore dialog is open for, if any.
  const [target, setTarget] = useState<BackupRun | null>(null);

  const latest = backups.find((b) => b.status === "SUCCESSFUL") ?? null;
  const age = freshness(latest?.startTime ?? null);

  async function refresh() {
    const res = await fetch("/api/backups");
    if (res.ok) setBackups((await res.json()).backups);
  }

  async function backUpNow() {
    setBackingUp(true);
    setFailure(null);
    setNotice(null);
    try {
      const res = await fetch("/api/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`Could not start a backup (${res.status})`);
      setNotice(
        "Backup started. It appears in the list below once Cloud SQL finishes it — refresh in a minute.",
      );
      await refresh();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Could not start a backup");
    } finally {
      setBackingUp(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Backups</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Cloud SQL backs up{" "}
            <code className="text-foreground">{instance ?? "the database"}</code>{" "}
            every night and keeps a week of them. Point-in-time recovery covers
            the gaps between, but only from the command line.
          </p>
        </div>

        <Button
          variant="outline"
          className="shrink-0"
          disabled={backingUp || error !== null}
          onClick={() => void backUpNow()}
        >
          {backingUp ? <Loader2 className="animate-spin" /> : <DatabaseBackup />}
          {backingUp ? "Starting…" : "Back up now"}
        </Button>
      </div>

      {error ? (
        <div className="mt-8 rounded-2xl border border-dashed p-8 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <DatabaseBackup className="size-5" />
          </span>
          <p className="mt-4 text-sm font-medium">Backups unavailable</p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
            {UNAVAILABLE[error] ?? UNAVAILABLE.unavailable}
          </p>
        </div>
      ) : (
        <>
          {/* The question this page is usually opened to answer. */}
          <div
            className={cn(
              "mt-6 flex items-center gap-3 rounded-xl border p-4 text-sm",
              age?.stale
                ? "border-destructive/40 bg-destructive/5"
                : "border-brand-border/60 bg-brand/5",
            )}
          >
            {age?.stale ? (
              <AlertTriangle className="size-4 shrink-0 text-destructive" />
            ) : (
              <CheckCircle2 className="size-4 shrink-0 text-brand" />
            )}
            <span>
              {latest ? (
                <>
                  Last good backup{" "}
                  <span className="font-medium">{age?.text}</span> —{" "}
                  {format(latest.startTime)}.
                  {age?.stale &&
                    " That is older than the daily schedule should allow; check that automated backups are enabled."}
                </>
              ) : (
                "No successful backup yet. If this instance was only just configured, the first one runs tonight."
              )}
            </span>
          </div>

          {notice && (
            <p className="mt-4 rounded-lg border border-brand-border/60 bg-brand/5 p-3 text-sm">
              {notice}
            </p>
          )}
          {failure && <p className="mt-4 text-sm text-destructive">{failure}</p>}

          {backups.length === 0 ? (
            <p className="mt-8 rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              No backups recorded yet.
            </p>
          ) : (
            <motion.ul
              variants={staggerParent()}
              initial="hidden"
              animate="show"
              className="mt-6 grid gap-2"
            >
              {backups.map((backup) => (
                <motion.li
                  key={backup.id}
                  variants={riseChild}
                  className="flex items-center gap-4 rounded-xl border bg-card/60 dark:bg-card p-4"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2.5">
                      <span className="tnum text-sm font-medium">
                        {format(backup.startTime)}
                      </span>
                      <Badge variant="secondary">
                        {backup.type === "AUTOMATED" ? "Daily" : "On demand"}
                      </Badge>
                    </span>
                    <span className="mt-1 flex items-center gap-3">
                      <StatusChip status={backup.status} />
                      {backup.error && (
                        <span className="truncate text-xs text-destructive">
                          {backup.error}
                        </span>
                      )}
                    </span>
                  </span>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={backup.status !== "SUCCESSFUL"}
                    onClick={() => setTarget(backup)}
                    className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <RotateCcw />
                    Restore
                  </Button>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </>
      )}

      <RestoreDialog
        backup={target}
        instance={instance}
        project={project}
        onClose={() => setTarget(null)}
        onRestored={() => {
          setTarget(null);
          router.refresh();
        }}
      />
    </div>
  );
}

type StrandedRun = { id: string; name: string; status: string };

/**
 * The confirmation. Deliberately not a one-click affair.
 *
 * It does three things a generic "are you sure" does not: names what a restore
 * actually replaces, lists the events that will be stranded by it, and makes
 * the administrator type the instance name. The stranded list is the important
 * one — it is fetched live, because it is the consequence nobody thinks of.
 */
function RestoreDialog({
  backup,
  instance,
  project,
  onClose,
  onRestored,
}: {
  backup: BackupRun | null;
  instance: string | null;
  project: string | null;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [stranded, setStranded] = useState<StrandedRun[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Reset per backup, during render rather than in an effect — an effect runs
  // after the paint, which would flash the previous backup's warning.
  //
  // `?? null` on both sides is load-bearing. The dialog is closed far more
  // often than it is open, and with the id left as `undefined` the comparison
  // against a `null` state is true forever: the reset sets state to the value
  // it already holds, React re-renders, and the guard fires again.
  const [shownFor, setShownFor] = useState<string | null>(null);
  const openFor = backup?.id ?? null;

  if (openFor !== shownFor) {
    setShownFor(openFor);
    setTyped("");
    setStranded(null);
    setError(null);
    setDone(false);
    if (backup?.startTime) void loadStranded(backup.startTime);
  }

  async function loadStranded(since: string) {
    try {
      const res = await fetch(
        `/api/runs/stranded?since=${encodeURIComponent(since)}`,
      );
      setStranded(res.ok ? (await res.json()).runs : []);
    } catch {
      setStranded([]);
    }
  }

  async function restore() {
    if (!backup) return;

    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/backups/${backup.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: typed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error === "confirmation_mismatch"
            ? "That is not the instance name."
            : body.error === "not_restorable"
              ? "That backup did not complete, so it cannot be restored."
              : `Could not start the restore (${res.status})`,
        );
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore");
      setPending(false);
    }
  }

  const armed = instance !== null && typed.trim() === instance && !pending;

  return (
    <Dialog open={backup !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>Restore started</DialogTitle>
              <DialogDescription className="leading-relaxed">
                Cloud SQL has accepted the operation. The database goes offline
                while it runs, so this app will fail for the next few minutes
                and you will be signed out — your session is one of the things
                being rolled back.
              </DialogDescription>
            </DialogHeader>

            <p className="text-sm leading-relaxed text-muted-foreground">
              Watch it finish in the Cloud Console, or with{" "}
              <code className="text-foreground">
                gcloud sql operations list --instance={instance}
                {project ? ` --project=${project}` : ""}
              </code>
              .
            </p>

            <DialogFooter>
              <Button variant="secondary" onClick={onRestored}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="size-5" />
                Restore over the live database
              </DialogTitle>
              <DialogDescription className="leading-relaxed">
                This replaces <strong>everything</strong> on{" "}
                <code>{instance}</code> with the backup from{" "}
                <strong>{format(backup?.startTime ?? null)}</strong> — every
                table, not just the lab guides. Anything written since is lost.
              </DialogDescription>
            </DialogHeader>

            <ul className="grid gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm leading-relaxed">
              <li>The app is offline for the length of the restore.</li>
              <li>
                Every signed-in user is signed out, you included — sessions are
                in the database being rolled back.
              </li>
              <li>
                Site roles revert to what they were at that moment. If anyone
                was promoted since, they lose it.
              </li>
            </ul>

            {/* The consequence nobody thinks of, made specific. */}
            {stranded === null ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Checking what this would strand…
              </p>
            ) : stranded.length > 0 ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-sm font-medium text-destructive">
                  {stranded.length === 1
                    ? "1 event would be stranded"
                    : `${stranded.length} events would be stranded`}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  These were provisioned after the backup was taken. Restoring
                  removes their records while their Google Cloud projects,
                  Workspace accounts, and Harness organizations keep running —
                  the reaper only tears down what it has a row for. Write these
                  down; they will need deleting by hand.
                </p>
                <ul className="mt-2 grid gap-1 text-xs">
                  {stranded.map((run) => (
                    <li key={run.id} className="flex items-center gap-2">
                      <span className="font-medium">{run.name}</span>
                      <span className="text-muted-foreground">
                        {run.status} · {run.id}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No events were provisioned after this backup, so nothing will be
                stranded in the clouds.
              </p>
            )}

            <div className="grid gap-1.5">
              <label htmlFor="restore-confirm" className="text-sm font-medium">
                Type <code className="text-foreground">{instance}</code> to
                confirm
              </label>
              <Input
                id="restore-confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={instance ?? ""}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="ghost" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!armed}
                onClick={() => void restore()}
              >
                {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                {pending ? "Starting…" : "Restore over live data"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
