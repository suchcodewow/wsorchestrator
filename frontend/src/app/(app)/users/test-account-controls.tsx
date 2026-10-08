"use client";

/**
 * Making a test account, and giving one a fresh start. Outside production
 * only; see src/lib/test-accounts.ts.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2, RotateCcw } from "lucide-react";
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
import { TEST_ACCOUNT_LIMITS } from "@/db/schema";

const ERRORS: Record<string, string> = {
  invalid: "Give it a name.",
  invalid_body: "Give it a name of up to 80 characters.",
  production: "Test accounts can't be made on production.",
  forbidden: "Only a platform administrator can do this.",
  not_found: "That test account no longer exists.",
  owns_events: "This test account owns events. Delete those first.",
  unauthorized: "Sign in again to do this.",
};

async function send(url: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return null;
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    return ERRORS[json?.error ?? ""] ?? `Could not save (${res.status})`;
  } catch {
    return "Could not reach the server.";
  }
}

export function CreateTestAccountDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || pending) return;
    setPending(true);
    setError(null);
    const failed = await send("/api/users/test-accounts", { name });
    setPending(false);
    if (failed) return setError(failed);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button
        variant="outline"
        className="shrink-0"
        onClick={() => {
          setName("");
          setError(null);
          setOpen(true);
        }}
      >
        <FlaskConical />
        New test account
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New test account</DialogTitle>
            <DialogDescription>
              An account to view the app as from your account menu, where
              anything you do is saved as it. It starts with no roles; set
              them in the table. Nobody can sign in as it.
            </DialogDescription>
          </DialogHeader>

          <Input
            autoFocus
            value={name}
            maxLength={TEST_ACCOUNT_LIMITS.name}
            placeholder="Iris tester, SDR track"
            aria-label="Name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={pending || !name.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ResetTestAccountButton({
  user,
  blockedBy,
}: {
  user: { id: string; name: string | null; email: string | null };
  /** Why it can't be reset, if it can't; shown on the disabled button. */
  blockedBy: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const who = user.name ?? user.email ?? "this test account";

  async function submit() {
    setPending(true);
    setError(null);
    const failed = await send(`/api/users/test-accounts/${user.id}/reset`);
    setPending(false);
    if (failed) return setError(failed);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <span title={blockedBy ?? `Reset ${who}`}>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          disabled={blockedBy !== null}
          aria-label={`Reset ${who}`}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          <RotateCcw />
        </Button>
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset {who}?</DialogTitle>
            <DialogDescription>
              Everything that is its own goes, as if it were deleted: Iris
              sittings and track, progress, tokens and settings. It keeps its
              name, address and roles. Anything it wrote elsewhere stays, with
              no author.
            </DialogDescription>
          </DialogHeader>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void submit()} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {pending ? "Resetting…" : "Reset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
