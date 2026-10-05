"use client";

/**
 * Production's backups, and the dialog that imports one over this deployment's
 * database. Only rendered where an import is possible (QA); see
 * `lib/production-import.ts`.
 */

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { AlertTriangle, DatabaseZap, Loader2 } from "lucide-react";
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
import { StatusChip, format, type BackupRun } from "./backups-table";

type HoldingRun = { id: string; name: string; status: string };

const UNAVAILABLE: Record<string, string> = {
  permission_denied:
    "The app's service account cannot read production's backups. Production grants that through backup_reader_members in infra/admin.",
  unavailable: "Could not reach the Cloud SQL API — try again in a moment.",
};

export function ProductionBackups({
  source,
  instance,
  project,
  region,
  initial,
  error,
  holding,
}: {
  /** Production's project and instance. */
  source: { project: string; instance: string };
  /** This deployment's instance, which the import replaces. */
  instance: string;
  project: string;
  region: string;
  initial: BackupRun[];
  error: string | null;
  holding: HoldingRun[];
}) {
  const [target, setTarget] = useState<BackupRun | null>(null);

  return (
    <section className="mt-12">
      <div>
        <h2 className="text-lg font-medium tracking-tight">Production backups</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Import one of{" "}
          <code className="text-foreground">
            {source.project}/{source.instance}
          </code>
          &apos;s backups to see production&apos;s workshops, guides and settings
          here. Imported events are read-only, and this deployment&apos;s runner
          never acts on them.
        </p>
      </div>

      {error ? (
        <p className="mt-6 rounded-2xl border border-dashed p-8 text-center text-sm leading-relaxed text-muted-foreground">
          {UNAVAILABLE[error] ?? UNAVAILABLE.unavailable}
        </p>
      ) : initial.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Production has no backups listed.
        </p>
      ) : (
        <motion.ul
          variants={staggerParent()}
          initial="hidden"
          animate="show"
          className="mt-6 grid gap-2"
        >
          {initial.map((backup) => (
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
                  {backup.description && (
                    <span className="truncate text-xs text-muted-foreground">
                      {backup.description}
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
                <DatabaseZap />
                Import
              </Button>
            </motion.li>
          ))}
        </motion.ul>
      )}

      <ImportDialog
        backup={target}
        instance={instance}
        project={project}
        region={region}
        holding={holding}
        onClose={() => setTarget(null)}
      />
    </section>
  );
}

function ImportDialog({
  backup,
  instance,
  project,
  region,
  holding: initialHolding,
  onClose,
}: {
  backup: BackupRun | null;
  instance: string;
  project: string;
  region: string;
  holding: HoldingRun[];
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [holding, setHolding] = useState(initialHolding);
  const [execution, setExecution] = useState<string | null | undefined>(undefined);

  const [shownFor, setShownFor] = useState<string | null>(null);
  const openFor = backup?.id ?? null;
  if (openFor !== shownFor) {
    setShownFor(openFor);
    setTyped("");
    setError(null);
    setExecution(undefined);
  }

  async function start() {
    if (!backup) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/backups/production/${backup.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: typed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.error === "runs_hold_resources") setHolding(body.holding ?? []);
        throw new Error(
          body.error === "confirmation_mismatch"
            ? "That is not this deployment's instance name."
            : body.error === "runs_hold_resources"
              ? "Events here still hold resources. Tear them down first."
              : body.error === "not_restorable"
                ? "That backup did not complete, so it cannot be imported."
                : `Could not start the import (${res.status})`,
        );
      }
      setExecution(body.execution ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the import");
    } finally {
      setPending(false);
    }
  }

  const logs = `https://console.cloud.google.com/run/jobs/details/${region}/tf-runner/executions?project=${project}`;
  const blocked = holding.length > 0;
  const armed = typed.trim() === instance && !pending && !blocked;

  return (
    <Dialog open={backup !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        {execution !== undefined ? (
          <>
            <DialogHeader>
              <DialogTitle>Import started</DialogTitle>
              <DialogDescription className="leading-relaxed">
                It takes a while: a backup of this deployment first, then the
                restore. The app goes offline partway through and everyone is
                signed out.
              </DialogDescription>
            </DialogHeader>

            <p className="text-sm leading-relaxed text-muted-foreground">
              Follow it in the logs of the{" "}
              <a href={logs} target="_blank" rel="noreferrer" className="text-foreground underline">
                tf-runner execution
              </a>
              {execution && (
                <>
                  {" "}
                  <code className="text-foreground">{execution.split("/").pop()}</code>
                </>
              )}
              . If it fails after the restore, restore the backup it took first,
              listed above as &ldquo;Before importing production backup&rdquo;.
            </p>

            <DialogFooter>
              <Button variant="secondary" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="size-5" />
                Replace this deployment&apos;s database with production&apos;s
              </DialogTitle>
              <DialogDescription className="leading-relaxed">
                Everything on <code>{instance}</code> is replaced by
                production&apos;s backup from{" "}
                <strong>{format(backup?.startTime ?? null)}</strong>.
              </DialogDescription>
            </DialogHeader>

            <ul className="grid gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm leading-relaxed">
              <li>
                A backup of this deployment is taken first. Restoring it undoes
                the import.
              </li>
              <li>
                The reaper and the scheduler are paused while it runs. Scheduled
                events here are lost.
              </li>
              <li>
                Production&apos;s events arrive read-only, with their attendee
                passwords removed.
              </li>
              <li>
                Production&apos;s saved Harness tokens, org secrets, template
                sources and API tokens are removed. Re-add this
                deployment&apos;s own afterwards.
              </li>
              <li>
                Roles become what they are here now. Everyone is signed out,
                you included.
              </li>
            </ul>

            {blocked && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-sm font-medium text-destructive">
                  {holding.length === 1
                    ? "1 event here still holds resources"
                    : `${holding.length} events here still hold resources`}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  The import would erase the only record of them. End and tear
                  them down, or delete them, first.
                </p>
                <ul className="mt-2 grid gap-1 text-xs">
                  {holding.map((run) => (
                    <li key={run.id} className="flex items-center gap-2">
                      <Link href={`/runs/${run.id}`} className="font-medium underline">
                        {run.name}
                      </Link>
                      <span className="text-muted-foreground">{run.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-1.5">
              <label htmlFor="import-confirm" className="text-sm font-medium">
                Type <code className="text-foreground">{instance}</code> to
                confirm
              </label>
              <Input
                id="import-confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={instance}
                autoComplete="off"
                spellCheck={false}
                disabled={blocked}
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
                onClick={() => void start()}
              >
                {pending ? <Loader2 className="animate-spin" /> : <DatabaseZap />}
                {pending ? "Starting…" : "Import production"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
