"use client";

/**
 * Making a test account, and giving one a fresh start. Outside production
 * only; see src/lib/test-accounts.ts.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnchoredToParent } from "@/components/use-anchored";
import { SEARCH_DEBOUNCE_MS } from "@/components/use-debounced-search";
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
import { cn } from "@/lib/utils";

const ERRORS: Record<string, string> = {
  invalid: "Give it a name.",
  source_not_found: "That user no longer exists. Choose someone else.",
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

/** An account the new test account can start as a copy of. */
type Source = { id: string; name: string | null; email: string | null; isPlatformAdmin: boolean };

/** How many matches the copy-from list shows; the rest are a sharper search away. */
const SHOWN_SOURCES = 6;

/** Accounts matching `q`, from the Users page's own list, fetched once typing pauses. */
function useSourceSearch(q: string, enabled: boolean): Source[] {
  const [matches, setMatches] = useState<Source[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users?${new URLSearchParams({ q })}`, { signal: ctrl.signal });
        const body = res.ok ? ((await res.json()) as { users?: Source[] }) : null;
        setMatches((body?.users ?? []).slice(0, SHOWN_SOURCES));
      } catch {
        // Aborted by the next keystroke, or offline: the list just stays as it was.
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, enabled]);

  return matches;
}

/** The list under the copy-from field. Render it inside the `relative` box around the field. */
function SourceMatches({ matches, onChoose }: { matches: Source[]; onChoose: (source: Source) => void }) {
  const ref = useAnchoredToParent<HTMLUListElement>(matches.length > 0);
  if (matches.length === 0) return null;

  return (
    <ul ref={ref} className="absolute top-0 left-0 z-20 overflow-y-auto rounded-md border bg-popover shadow-md">
      {matches.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            disabled={s.isPlatformAdmin}
            title={s.isPlatformAdmin ? "A platform administrator already sees everything" : undefined}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => onChoose(s)}
            className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>{s.name ?? s.email}</span>
            <span className="text-xs text-muted-foreground">
              {s.isPlatformAdmin ? "Platform administrator — can't be copied" : s.email}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function CreateTestAccountDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim();
  const searching = q.length > 0 && !source;
  const matches = useSourceSearch(q, searching);

  function choose(s: Source) {
    setSource(s);
    setQuery(s.name ?? s.email ?? "");
    setListOpen(false);
    if (!name.trim()) setName(`Test: ${s.name ?? s.email}`.slice(0, TEST_ACCOUNT_LIMITS.name));
  }

  async function submit() {
    if (!name.trim() || pending) return;
    setPending(true);
    setError(null);
    const failed = await send("/api/users/test-accounts", { name, ...(source && { copyFrom: source.id }) });
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
                  placeholder="Search users by name or email"
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
                {listOpen && searching && <SourceMatches matches={matches} onChoose={choose} />}
              </div>
              <p className="text-xs text-muted-foreground">
                {source
                  ? `Starts with ${source.name ?? source.email}'s roles, theme and calendar settings, and Iris track, copied once. Not their test results or progress.`
                  : "Without one, it starts with no roles; set them in the table."}
              </p>
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="test-account-name" className="text-sm font-medium">
                Name
              </label>
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
