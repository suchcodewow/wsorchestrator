"use client";

/** Deletes an event, after saying what that tears down. */

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
    "This event can only be deleted once provisioning has finished.",
  unauthorized: "Sign in again to delete this event.",
};

function consequence(run: WorkshopRun): {
  blurb: string;
  confirm: string;
  disabled?: boolean;
} {
  switch (run.status as RunStatus) {
    case "scheduled":
      return {
        blurb:
          "Nothing has been provisioned yet, so this only takes it off the calendar.",
        confirm: "Delete event",
      };
    case "destroyed":
      return {
        blurb:
          "This event is already torn down, so only its record and build log are removed.",
        confirm: "Delete event",
      };
    case "requested":
    case "provisioning":
    case "applying":
      return {
        blurb:
          "Provisioning is still running, so wait for it to finish before deleting.",
        confirm: "Delete event",
        disabled: true,
      };
    case "destroying":
      return {
        blurb:
          "Teardown is already running, so the event is removed as soon as it finishes.",
        confirm: "Delete when torn down",
      };
    default:
      return {
        blurb:
          "Everything this event created is torn down first, which takes a few minutes.",
        confirm: "Tear down and delete",
      };
  }
}

export function DeleteEventButton({
  run,
  owned,
  onRequested,
}: {
  run: WorkshopRun;
  owned: boolean;
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
              This event belongs to someone else and they are not asked
              first.
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
