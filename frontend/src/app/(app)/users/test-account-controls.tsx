"use client";

/**
 * Making a test account, and giving one a fresh start. Outside production
 * only; see src/lib/test-accounts.ts.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2, Recycle, RotateCcw, VenetianMask, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmployeeMatches, useEmployeeSearch, type EmployeeCandidate } from "@/components/employee-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { impersonate } from "@/components/user-menu";
import { TEST_ACCOUNT_LIMITS } from "@/db/schema";
import { cn } from "@/lib/utils";

const ERRORS: Record<string, string> = {
  invalid: "Give it a name.",
  source_not_found: "That person is no longer in the employee list. Choose someone else.",
  platform_source: "A platform administrator already sees everything. Choose someone else.",
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

/**
 * The name a new test account starts with: a character's no account has yet,
 * other than `skip`; or none when all are taken.
 */
async function fetchSuggestedName(skip?: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/users/test-accounts?${new URLSearchParams(skip ? { skip } : {})}`);
    const body = res.ok ? ((await res.json()) as { suggestedName?: string | null }) : null;
    return body?.suggestedName ?? null;
  } catch {
    return null;
  }
}

export function CreateTestAccountDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [source, setSource] = useState<EmployeeCandidate | null>(null);
  const [pending, setPending] = useState(false);
  const [rerolling, setRerolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim();
  const searching = q.length > 0 && !source;
  const { matches } = useEmployeeSearch(q, searching);

  function choose(e: EmployeeCandidate) {
    setSource(e);
    setQuery(e.fullName);
    setListOpen(false);
    if (!name.trim()) setName(`Test: ${e.fullName}`.slice(0, TEST_ACCOUNT_LIMITS.name));
  }

  /** Another character's name in place of the one shown; kept as it is when none is left. */
  async function reroll() {
    setRerolling(true);
    const next = await fetchSuggestedName(name.trim() || undefined);
    setRerolling(false);
    if (next) setName(next);
  }

  async function submit() {
    if (!name.trim() || pending) return;
    setPending(true);
    setError(null);
    const failed = await send("/api/users/test-accounts", { name, ...(source && { copyFrom: source.email }) });
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
          setQuery("");
          setSource(null);
          setError(null);
          setOpen(true);
          // Only if nothing has been typed in the meantime.
          void fetchSuggestedName().then((suggested) => {
            if (suggested) setName((typed) => typed || suggested);
          });
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
              anything you do is saved as it. Nobody can sign in as it.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <label htmlFor="test-account-source" className="text-sm font-medium">
                Copy from <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <div className="relative">
                <Input
                  id="test-account-source"
                  autoFocus
                  value={query}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Search employees by name or email"
                  className={cn(source && "pr-9")}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSource(null);
                    setListOpen(true);
                  }}
                  onFocus={() => setListOpen(true)}
                  onBlur={() => setListOpen(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && listOpen) {
                      e.stopPropagation();
                      setListOpen(false);
                    }
                  }}
                />
                {source && (
                  <button
                    type="button"
                    aria-label="Don't copy anyone"
                    onClick={() => {
                      setSource(null);
                      setQuery("");
                    }}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
                {listOpen && searching && <EmployeeMatches matches={matches} onChoose={choose} />}
              </div>
              <p className="text-xs text-muted-foreground">
                {source
                  ? `Starts with ${source.fullName}'s roles, theme and calendar settings, and Iris track, copied once, or no roles if they have never signed in. Not their test results or progress.`
                  : "Without one, it starts with no roles; set them in the table."}
              </p>
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="test-account-name" className="text-sm font-medium">
                Name
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="test-account-name"
                  value={name}
                  maxLength={TEST_ACCOUNT_LIMITS.name}
                  placeholder="Iris tester, SDR track"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  title="Another character's name"
                  aria-label="Another character's name"
                  disabled={rerolling}
                  onClick={() => void reroll()}
                >
                  {rerolling ? <Loader2 className="animate-spin" /> : <Recycle />}
                </Button>
              </div>
            </div>
          </div>

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

/** Views the app as a test account, as picking it in the account menu does; the app reloads as it. */
export function ViewAsTestAccountButton({
  user,
  onError,
}: {
  user: { name: string | null; email: string | null };
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const who = user.name ?? user.email ?? "this test account";

  async function start() {
    if (!user.email) return;
    setPending(true);
    const failed = await impersonate(user.email);
    // On success the page is already going away.
    if (failed) {
      setPending(false);
      onError(failed);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      // In the "Test account" tag's colours, so it reads as belonging to it.
      className="size-8 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
      title={`View as ${who}`}
      aria-label={`View as ${who}`}
      disabled={pending || !user.email}
      onClick={() => void start()}
    >
      {pending ? <Loader2 className="animate-spin" /> : <VenetianMask />}
    </Button>
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
