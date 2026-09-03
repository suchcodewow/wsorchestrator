"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MAX_HARNESS_TOKENS_PER_USER } from "@/db/schema";
import { messageFor } from "@/lib/harness-token-errors";
import { permissionLabel } from "@/lib/harness-permissions";
import type { HarnessTokenSummary } from "@/lib/harness-tokens";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/** What Harness calls the principal, in words somebody would recognise. */
const PRINCIPAL_LABEL: Record<string, string> = {
  USER: "Personal token",
  SERVICE_ACCOUNT: "Service account",
};

/**
 * What to call a saved token. The account name comes from Harness during the
 * check, so there is no label to fall back to — only the account id, for a token
 * that is valid but not allowed to read its own account.
 */
const tokenName = (t: HarnessTokenSummary) => t.accountName ?? t.accountId;

export function HarnessTokensView({
  tokens,
  baseUrl,
  configured,
}: {
  tokens: HarnessTokenSummary[];
  baseUrl: string;
  /** Whether an encryption key exists. Without one nothing can be saved. */
  configured: boolean;
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const full = tokens.length >= MAX_HARNESS_TOKENS_PER_USER;

  /**
   * One place for the fetch and the error shape. Every route here answers with
   * `{ error, detail }`, and `messageFor` is what turns that into the sentence —
   * shared with the server so the two agree on what each error means.
   */
  async function call(
    key: string,
    path: string,
    init: RequestInit,
  ): Promise<Record<string, unknown> | null> {
    setBusy(key);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
      const body = (await res.json().catch(() => null)) as {
        error?: unknown;
        detail?: unknown;
      } | null;
      if (!res.ok) {
        setError(messageFor(body?.error, res.status, body?.detail));
        return null;
      }
      return body as Record<string, unknown>;
    } catch {
      setError("Could not reach the server.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (token.trim().length === 0 || full) return;
    const body = await call("save", "/api/me/harness-tokens", {
      method: "POST",
      body: JSON.stringify({ token: token.trim() }),
    });
    if (!body) return;

    const added = body.token as HarnessTokenSummary;
    // Cleared on success and not before: a token Harness rejected is still in
    // the field, which is what lets somebody fix a truncated paste rather than
    // fetch it again.
    setToken("");
    setReveal(false);
    // Names the account Harness reported, which is the confirmation that matters:
    // it is how somebody sees they pasted the token they meant to.
    setSaved(
      `Saved for ${tokenName(added)} — ${
        added.permissions.filter((p) => p.permitted).length
      } of ${added.permissions.length} checked permissions granted.`,
    );
    router.refresh();
  }

  async function recheck(id: string) {
    if (await call(id, `/api/me/harness-tokens/${id}`, { method: "POST" })) {
      setSaved("Re-checked with Harness.");
      router.refresh();
    }
  }

  async function remove(id: string) {
    if (await call(id, `/api/me/harness-tokens/${id}`, { method: "DELETE" })) {
      router.refresh();
    }
  }

  return (
    <motion.div
      variants={staggerParent(0.05)}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Harness tokens</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Paste a Harness platform token and it is checked against{" "}
          <span className="font-mono text-xs">{baseUrl}</span> before it is saved
          — which account it is for, what that account is called, who the token
          acts as, and what it is allowed to do. Only tokens Harness accepts end
          up in the list below. They are stored encrypted and never shown again.
        </p>
      </motion.div>

      {!configured && (
        <motion.div
          variants={riseChild}
          role="alert"
          className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>
            This deployment has no encryption key, so a token cannot be stored
            safely. An administrator needs to set <code>AUTH_SECRET</code> or{" "}
            <code>HARNESS_TOKEN_ENC_KEY</code>.
          </span>
        </motion.div>
      )}

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      {saved && !error && (
        <motion.p variants={riseChild} role="status" className="text-sm text-brand">
          {saved}
        </motion.p>
      )}

      {/* New token */}
      <motion.div variants={riseChild}>
        <Card>
          <CardContent className="space-y-3 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-64 flex-1">
                <Input
                  // A password field by default: this is a live credential, and
                  // it is pasted more often than typed. The reveal is there for
                  // the one case that matters — checking a paste that Harness
                  // just rejected.
                  type={reveal ? "text" : "password"}
                  value={token}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="pat.xxxxxxxx.xxxxxxxx.xxxxxxxx"
                  aria-label="Harness platform token"
                  disabled={!configured || full}
                  className="pr-9 font-mono"
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && save()}
                />
                <button
                  type="button"
                  onClick={() => setReveal((r) => !r)}
                  aria-label={reveal ? "Hide token" : "Show token"}
                  className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                >
                  {reveal ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>

              <Button
                onClick={save}
                disabled={
                  !configured || full || busy === "save" || token.trim().length === 0
                }
              >
                {busy === "save" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Save
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              {full ? (
                <>
                  {MAX_HARNESS_TOKENS_PER_USER} saved tokens is the limit — remove
                  one first.
                </>
              ) : (
                <>
                  Nothing else to fill in — the account is read out of the token
                  and its name comes back from Harness with the check.
                </>
              )}
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Saved tokens */}
      <motion.div variants={riseChild}>
        {tokens.length === 0 ? (
          <p className="rounded-2xl border border-dashed px-5 py-8 text-center text-sm text-muted-foreground">
            No tokens saved yet.
          </p>
        ) : (
          <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
            {tokens.map((t) => (
              <TokenRow
                key={t.id}
                token={t}
                busy={busy === t.id}
                expanded={expanded === t.id}
                onToggle={() =>
                  setExpanded((current) => (current === t.id ? null : t.id))
                }
                onRecheck={() => recheck(t.id)}
                onRemove={() => remove(t.id)}
              />
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function TokenRow({
  token,
  busy,
  expanded,
  onToggle,
  onRecheck,
  onRemove,
}: {
  token: HarnessTokenSummary;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRecheck: () => void;
  onRemove: () => void;
}) {
  const granted = token.permissions.filter((p) => p.permitted).length;
  // A row saved before the probe list changed has answers for a different set of
  // permissions, so its own count is the denominator rather than today's list.
  const checked = token.permissions.length;
  const name = tokenName(token);

  return (
    <div className="space-y-2 px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="font-medium">{name}</span>

        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {PRINCIPAL_LABEL[token.principalType ?? ""] ??
            (token.kind === "sat" ? "Service account" : "Personal token")}
        </span>

        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-muted-foreground">
          …{token.tail}
        </code>

        {!token.usable && (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="size-3.5" />
            can&apos;t be decrypted — paste it again
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={busy || !token.usable}
            onClick={onRecheck}
            title="Ask Harness about this token again"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Re-check
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove the token for ${name}`}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            disabled={busy}
            onClick={onRemove}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Interleaved rather than written out, because any of these can be absent
          and a hard-coded separator between two of them leaves a stray dot. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {[
          // The heading is the account name, so the id only earns its own place
          // here when it is not already standing in for that name.
          token.accountName !== null ? (
            <code className="font-mono">{token.accountId}</code>
          ) : null,
          token.principal,
          token.verifiedAt
            ? `verified ${shortDate(token.verifiedAt)}`
            : "not currently valid",
        ]
          .filter(Boolean)
          .map((part, i) => (
            <Fragment key={i}>
              {i > 0 && <span>·</span>}
              {part}
            </Fragment>
          ))}
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        {/* "0 of 0" would read as a token that may do nothing, which is a
            different claim from never having been asked. */}
        {checked === 0
          ? "No permission check recorded"
          : `${granted} of ${checked} checked permissions granted`}
      </button>

      {expanded && (
        <ul className="grid gap-x-6 gap-y-1 pt-1 text-xs sm:grid-cols-2">
          {token.permissions.map((p) => (
            <li
              key={`${p.resourceType}:${p.permission}`}
              className={cn(
                "flex items-center gap-1.5",
                p.permitted ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {p.permitted ? (
                <Check className="size-3.5 shrink-0 text-brand" />
              ) : (
                <X className="size-3.5 shrink-0" />
              )}
              {permissionLabel(p.permission)}
            </li>
          ))}
          {token.permissions.length === 0 && (
            <li className="text-muted-foreground">
              Harness did not answer the permission check for this token.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
