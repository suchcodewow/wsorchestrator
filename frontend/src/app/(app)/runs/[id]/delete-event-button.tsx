"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RunStatus, WorkshopRun } from "@/db/schema";

const ERRORS: Record<string, string> = {
  not_found: "This event no longer exists.",
  in_flight:
    "This event is provisioning right now. It can be deleted once it finishes — or fails.",
  unauthorized: "Sign in again to delete this event.",
};

/**
 * What deleting this run will actually do, in the words the dialog uses.
 *
 * Three shapes, because a run's resources decide how final a delete can be:
 * nothing built yet, everything already torn down, or live things that have to
 * be destroyed before the record can go.
 */
function consequence(run: WorkshopRun): {
  blurb: string;
  confirm: string;
  disabled?: boolean;
} {
  switch (run.status as RunStatus) {
    case "scheduled":
      return {
        blurb:
          "Nothing has been provisioned yet, so this just takes it off the calendar. It will not start.",
        confirm: "Delete event",
      };
    case "destroyed":
      return {
        blurb:
          "This event has already been torn down. Deleting it removes the record and its build log.",
        confirm: "Delete event",
      };
    case "requested":
    case "provisioning":
    case "applying":
      return {
        blurb:
          "Provisioning is in flight — accounts and cloud projects are being created right now. Wait for it to settle, then delete it; the teardown needs to know what exists.",
        confirm: "Delete event",
        disabled: true,
      };
    case "destroying":
      return {
        blurb:
          "Teardown is already running. Deleting now removes the event as soon as that finishes.",
        confirm: "Delete when torn down",
      };
    default:
      return {
        blurb:
          "This event owns live attendee accounts, an org unit, and cloud resources. They are torn down first — usually within a few minutes — and the event disappears once that is done.",
        confirm: "Tear down and delete",
      };
  }
}

/**
 * Delete an event. Rendered for its owner and for a manager or above; the API
 * checks the same thing again, so this only decides what is worth showing.
 */
export function DeleteEventButton({
  run,
  owned,
  onRequested,
}: {
  run: WorkshopRun;
  /** False when a manager is looking at somebody else's event. */
  owned: boolean;
  /** Teardown was requested — the run is still there, with new log lines. */
  onRequested: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { blurb, confirm, disabled } = consequence(run);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${run.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          ERRORS[body?.error] ?? `Could not delete (${res.status})`,
        );
      }

      setOpen(false);
      if (body?.outcome === "deleted") {
        // The page this is on no longer has anything to render.
        router.push("/events");
        router.refresh();
      } else {
        onRequested();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 />
        Delete
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{run.name}”?</DialogTitle>
            <DialogDescription>{blurb}</DialogDescription>
          </DialogHeader>

          {!owned && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/8 px-3 py-2 text-sm">
              This event belongs to someone else. You are deleting it as a
              manager — they are not asked first.
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={submit}
              disabled={pending || disabled}
            >
              {pending && <Loader2 className="animate-spin" />}
              {pending ? "Deleting…" : confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
