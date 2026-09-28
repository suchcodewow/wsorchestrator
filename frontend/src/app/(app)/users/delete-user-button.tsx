"use client";

/** Deletes an account, after saying what goes with it. */

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

const ERRORS: Record<string, string> = {
  self: "You can't delete your own account.",
  not_found: "That account no longer exists.",
  forbidden: "Only a platform administrator can delete accounts.",
  bootstrap:
    "That address is in SITE_ADMIN_EMAILS, which recreates it as a platform administrator on its next sign-in.",
  owns_events: "This person owns events. Delete those first.",
  unauthorized: "Sign in again to delete this account.",
};

export function DeleteUserButton({
  user,
  blockedBy,
}: {
  user: { id: string; name: string | null; email: string | null };
  /** Why this account can't be deleted, if it can't; shown on the disabled button. */
  blockedBy: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const who = user.name ?? user.email ?? "this account";

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(ERRORS[body?.error] ?? `Could not delete (${res.status})`);
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <span title={blockedBy ?? `Delete ${who}`}>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          disabled={blockedBy !== null}
          aria-label={`Delete ${who}`}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          <Trash2 />
        </Button>
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {who}?</DialogTitle>
            <DialogDescription>
              Their account, sessions, access tokens and personal Harness
              settings are removed. Lab guides, workshops and components they
              wrote stay, with no author. If their address can still sign in,
              they come back as a new account with no roles.
            </DialogDescription>
          </DialogHeader>

          {user.name && user.email && (
            <p className="font-mono text-sm text-muted-foreground">{user.email}</p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {pending ? "Deleting…" : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
