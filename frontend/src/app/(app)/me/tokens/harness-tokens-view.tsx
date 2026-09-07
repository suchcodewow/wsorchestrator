"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Eraser,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MAX_HARNESS_TOKENS_PER_USER } from "@/db/schema";
import type { DeployOutcome, DeployReport } from "@/lib/harness-deploy";
import { messageFor as deployMessageFor } from "@/lib/harness-deploy-errors";
import { harnessIdentifier } from "@/lib/harness-identifier";
import { messageFor } from "@/lib/harness-token-errors";
import { administersAccount, permissionLabel } from "@/lib/harness-permissions";
import type { ScrubRun, ScrubSummary } from "@/lib/harness-scrub";
import type { HarnessTokenSummary } from "@/lib/harness-tokens";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/**
 * A date *and* a time, for the one thing on this page where the time of day is
 * part of the answer: two deploys into the same account on the same afternoon are
 * told apart by nothing else.
 */
const stamp = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * How long until a deadline, in the largest unit that still says something.
 *
 * Days for the normal case — the window is a week — hours on the last day, and
 * "any moment now" once it is past, which is the truth: the sweep runs on a
 * timer, so a deadline in the past means the next tick, not that nothing
 * happened.
 */
function until(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "any moment now";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/** Whether a token has any deployed credentials on record at all. */
const hasScrubRecord = (s: ScrubSummary) =>
  s.pending + s.scrubbed + s.skipped + s.failed > 0;

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
  canDeploy,
  scrubDays,
}: {
  tokens: HarnessTokenSummary[];
  baseUrl: string;
  /** Whether an encryption key exists. Without one nothing can be saved. */
  configured: boolean;
  /** Days a deploy's real secret values live before being scrubbed to `123`. */
  scrubDays: number;
  /**
   * Whether this user may administer site settings. Half the deploy gate — the
   * other half is the token administering its Harness account — because a deploy
   * reads every org secret and every template source the site holds.
   */
  canDeploy: boolean;
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
    const body = await call(id, `/api/me/harness-tokens/${id}`, {
      method: "DELETE",
    });
    if (!body) return;

    // Removing a token scrubs what it deployed first, because afterwards nothing
    // can — so anything left behind has to be said here. This is the last moment
    // somebody is looking at a row that is about to stop existing.
    const scrub = body.scrub as ScrubRun | null;
    if (scrub && scrub.problems.length > 0) {
      setError(
        `Token removed, but ${scrub.problems.length} of this site's secrets could ` +
          `not be scrubbed from Harness: ${scrub.problems
            .map((p) => p.secretIdentifier)
            .join(", ")}. Nothing here can reach them now — remove them in ` +
          `Harness by hand.`,
      );
    } else if (scrub && scrub.scrubbed > 0) {
      setSaved(
        `Token removed, and ${scrub.scrubbed} deployed secret${
          scrub.scrubbed === 1 ? "" : "s"
        } scrubbed from Harness on the way out.`,
      );
    }
    router.refresh();
  }

  /**
   * Take the site's credentials back out of what a token deployed, now.
   *
   * Its own function rather than a `call`, because a partial result is the normal
   * one — secrets somebody else has since edited are left alone on purpose — so
   * the answer is a count and a list rather than success or failure.
   */
  async function scrub(id: string): Promise<ScrubRun | null> {
    const body = await call(`scrub:${id}`, `/api/me/harness-tokens/${id}/scrub`, {
      method: "POST",
    });
    if (!body) return null;
    router.refresh();
    return body.run as ScrubRun;
  }

  /**
   * Build a Harness organization from the site's settings with this token.
   *
   * Not routed through `call`: this one has its own error vocabulary — an
   * organization that already exists, a token that no longer administers the
   * account — and `deployMessageFor` is the module that knows those sentences.
   * The row is left to render the report, because a report is a page of detail
   * and belongs next to the token it was deployed with rather than in the banner
   * every other message shares.
   */
  async function deploy(
    id: string,
    org: string,
  ): Promise<DeployReport | null> {
    setBusy(`deploy:${id}`);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(`/api/me/harness-tokens/${id}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: unknown;
        detail?: unknown;
        report?: DeployReport;
      } | null;
      if (!res.ok || !body?.report) {
        setError(deployMessageFor(body?.error, res.status, body?.detail));
        return null;
      }
      // The row now has a deploy on it — where it went and when — and that is
      // server state, so it comes back from a refresh rather than being mirrored
      // into local state here.
      router.refresh();
      return body.report;
    } catch {
      // A deploy runs long enough to outlive a laptop lid. Worth saying that the
      // organization may exist regardless, because it very likely does.
      setError(
        "Lost contact with the server while deploying. Check the organization in Harness before trying again.",
      );
      return null;
    } finally {
      setBusy(null);
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
                // Its own flag rather than folded into `busy`: a deploy takes
                // minutes, and the row has to keep saying which of the two it is
                // waiting on.
                deploying={busy === `deploy:${t.id}`}
                scrubbing={busy === `scrub:${t.id}`}
                // Both halves of the gate. The site role is the same for every
                // row; the permission is this token's.
                canDeploy={canDeploy && administersAccount(t.permissions)}
                expanded={expanded === t.id}
                onToggle={() =>
                  setExpanded((current) => (current === t.id ? null : t.id))
                }
                onRecheck={() => recheck(t.id)}
                onRemove={() => remove(t.id)}
                scrubDays={scrubDays}
                onDeploy={(org) => deploy(t.id, org)}
                onScrub={() => scrub(t.id)}
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
  deploying,
  scrubbing,
  canDeploy,
  scrubDays,
  expanded,
  onToggle,
  onRecheck,
  onRemove,
  onDeploy,
  onScrub,
}: {
  token: HarnessTokenSummary;
  busy: boolean;
  /** A deploy is in flight for this row. Minutes, not the moment a re-check is. */
  deploying: boolean;
  /** A scrub is in flight: a couple of Harness calls per deployed secret. */
  scrubbing: boolean;
  /** Whether to offer a deploy at all — both halves of the gate, already ANDed. */
  canDeploy: boolean;
  /** Days the deployed secret values stay real. Said in the prompt, before the act. */
  scrubDays: number;
  expanded: boolean;
  onToggle: () => void;
  onRecheck: () => void;
  onRemove: () => void;
  onDeploy: (org: string) => Promise<DeployReport | null>;
  onScrub: () => Promise<ScrubRun | null>;
}) {
  const granted = token.permissions.filter((p) => p.permitted).length;
  // A row saved before the probe list changed has answers for a different set of
  // permissions, so its own count is the denominator rather than today's list.
  const checked = token.permissions.length;
  const name = tokenName(token);

  /** Whether the org prompt is open. Closed until the button is pressed. */
  const [prompting, setPrompting] = useState(false);
  // Prefilled with wherever this token last deployed. Deploying twice into the
  // same organization is the normal case — it is how a deploy with a couple of
  // failures in it gets finished — so the name that worked is the default, and
  // deploying somewhere new means editing it.
  const [org, setOrg] = useState(token.lastDeploy?.orgName ?? "");
  const [report, setReport] = useState<DeployReport | null>(null);

  // Derived rather than validated on submit, and shown, because a name with a
  // space or a hyphen in it becomes a different string in Harness and nobody
  // should have to discover that from the result.
  const identifier = harnessIdentifier(org);

  /**
   * Whether submitting would deploy into the organization this token already
   * built, rather than make a new one.
   *
   * Compared on the identifier, and case-insensitively, because that is how
   * Harness compares: "My Org", "my-org" and "MY_ORG" are all one organization
   * there. Same rule as the server's — see `deployContent`.
   */
  const rerun =
    identifier !== null &&
    identifier.toLowerCase() ===
      token.lastDeploy?.orgIdentifier.toLowerCase();

  /** What a just-pressed "Scrub now" did, until the row is next re-rendered. */
  const [scrubbed, setScrubbed] = useState<ScrubRun | null>(null);

  async function submit() {
    if (identifier === null || deploying) return;
    const result = await onDeploy(org);
    if (!result) return;
    // The name is left in the field either way: on success it is the new default
    // for a re-run, and on failure it is what lets somebody fix a collision or a
    // typo rather than retype the whole thing.
    setPrompting(false);
    setReport(result);
  }

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
          {canDeploy && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={busy || deploying || !token.usable}
              // Toggles the prompt rather than deploying: this creates an
              // organization and fills it with the site's credentials, so it is
              // not something a stray click should be able to do.
              onClick={() => setPrompting((open) => !open)}
              title="Create a Harness org and fill it from this site's settings"
            >
              {deploying ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Rocket className="size-4" />
              )}
              Deploy content
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={busy || deploying || !token.usable}
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
            disabled={busy || deploying}
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

      {/* Its own line rather than another item in the list above: it names a
          place in another system and links to it, which is a different kind of
          fact from when the token was last verified. */}
      {token.lastDeploy && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Rocket className="size-3.5 shrink-0" />
          <span>
            Deployed to{" "}
            <a
              href={token.lastDeploy.orgUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground hover:underline"
            >
              {token.lastDeploy.orgName}
            </a>
          </span>
          {/* The identifier only when it says something the name did not — a
              name Harness could use verbatim would just be printed twice. */}
          {token.lastDeploy.orgIdentifier !== token.lastDeploy.orgName && (
            <code className="rounded bg-muted px-1 py-0.5 font-mono">
              {token.lastDeploy.orgIdentifier}
            </code>
          )}
          <span>·</span>
          <time dateTime={token.lastDeploy.at}>{stamp(token.lastDeploy.at)}</time>
        </div>
      )}

      <DeployedCredentials
        scrub={token.scrub}
        scrubbing={scrubbing}
        disabled={busy || deploying || !token.usable}
        run={scrubbed}
        onScrub={async () => setScrubbed(await onScrub())}
        onDismiss={() => setScrubbed(null)}
      />

      {prompting && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {rerun ? (
              <>
                Into{" "}
                <span className="font-medium text-foreground">
                  {token.lastDeploy?.orgName}
                </span>{" "}
                again, which this token already built. Anything already there is
                left as it is, so this is how a deploy with failures in it gets
                finished — change the name to build somewhere new instead.
              </>
            ) : (
              <>
                A new organization in{" "}
                <span className="font-medium text-foreground">{name}</span>,
                filled with every secret from Settings → Org Secrets and
                everything each template source holds — connectors, templates,
                environments, and infrastructure definitions. Sources naming a
                whole organization land at org level; sources naming a project
                get a project of the same name.
              </>
            )}
          </p>
          {/* Before the button, not after it. The secrets that go in are real
              credentials of this site's, landing in an account somebody else
              owns — that they come back out again is the thing that makes this
              safe to do, so it is said while there is still a choice. */}
          <p className="text-xs leading-relaxed text-muted-foreground">
            The org secrets go in with their real values so the content works
            immediately, and{" "}
            <span className="font-medium text-foreground">
              {scrubDays === 0
                ? "are scrubbed to 123 at the next sweep"
                : `are scrubbed to 123 after ${scrubDays} day${
                    scrubDays === 1 ? "" : "s"
                  }`}
            </span>
            , so this deployment&apos;s credentials do not stay in another
            account. This row counts down to it, and can do it early.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={org}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="Organization name"
              aria-label="Name for the new Harness organization"
              disabled={deploying}
              className="min-w-56 flex-1"
              onChange={(e) => setOrg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") setPrompting(false);
              }}
            />
            <Button
              variant="brand"
              disabled={identifier === null || deploying}
              onClick={submit}
            >
              {deploying && <Loader2 className="size-4 animate-spin" />}
              {rerun ? "Deploy again" : "Deploy"}
            </Button>
            <Button
              variant="ghost"
              disabled={deploying}
              onClick={() => setPrompting(false)}
            >
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {identifier === null ? (
              org.trim().length === 0 ? (
                <>Harness needs a name to create the organization under.</>
              ) : (
                <>
                  Nothing in that name is legal in a Harness identifier — it needs
                  a letter, digit, or underscore somewhere.
                </>
              )
            ) : (
              <>
                Harness identifier:{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  {/* On a re-run, the identifier Harness already has rather than
                      the one this spelling would derive — they differ only in
                      case, and the existing one is what gets written to. */}
                  {rerun ? token.lastDeploy?.orgIdentifier : identifier}
                </code>
                {deploying && (
                  <> — this runs one call per entity, so give it a minute.</>
                )}
              </>
            )}
          </p>
        </div>
      )}

      {report && <DeployReportPanel report={report} onClose={() => setReport(null)} />}

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

/**
 * What has become of the site's credentials this token deployed.
 *
 * The visible half of the scrub design, and the reason it is on the row rather
 * than somewhere in settings: the credentials went out with *this* token, and
 * whoever deployed them is the person who should see a week's countdown running
 * down every time they open the page. A scheduled job that silently stops is the
 * failure this is against — the counting-down line and the button next to it are
 * what make that noticeable and fixable.
 *
 * Absent entirely for a token that never deployed a secret, so a row that has
 * nothing to say says nothing.
 */
function DeployedCredentials({
  scrub,
  scrubbing,
  disabled,
  run,
  onScrub,
  onDismiss,
}: {
  scrub: ScrubSummary;
  scrubbing: boolean;
  disabled: boolean;
  /** The result of a scrub just pressed here, if there was one. */
  run: ScrubRun | null;
  onScrub: () => Promise<void>;
  onDismiss: () => void;
}) {
  if (!hasScrubRecord(scrub)) return null;

  const where =
    scrub.orgs.length === 1 ? (
      <code className="rounded bg-muted px-1 py-0.5 font-mono">{scrub.orgs[0]}</code>
    ) : (
      <>{scrub.orgs.length} organizations</>
    );

  // Offered while anything could still be taken out. A scrub that failed is
  // worth retrying; one that was skipped is not ours to retry.
  const canScrub = scrub.pending > 0 || scrub.failed > 0;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {scrub.pending > 0 ? (
          <>
            <KeyRound className="size-3.5 shrink-0" />
            <span>
              <span className="font-medium text-foreground">{scrub.pending}</span>{" "}
              of this site&apos;s secret{scrub.pending === 1 ? "" : "s"}{" "}
              {scrub.pending === 1 ? "is" : "are"} live in {where} — scrubbed to{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">123</code>{" "}
              {scrub.dueAt ? until(scrub.dueAt) : "at the next sweep"}
            </span>
          </>
        ) : scrub.problems.length === 0 ? (
          <>
            <ShieldCheck className="size-3.5 shrink-0 text-brand" />
            <span>
              Deployed credentials scrubbed
              {scrub.scrubbedAt && (
                <>
                  {" "}
                  <time dateTime={scrub.scrubbedAt}>{stamp(scrub.scrubbedAt)}</time>
                </>
              )}
              {" — "}
              {scrub.scrubbed} value{scrub.scrubbed === 1 ? "" : "s"} in {where}{" "}
              now hold{scrub.scrubbed === 1 ? "s" : ""} a placeholder
            </span>
          </>
        ) : (
          <>
            <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
            <span>
              {scrub.problems.length} of this site&apos;s secrets in {where} could
              not be scrubbed
            </span>
          </>
        )}

        {canScrub && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-2 text-xs text-muted-foreground"
            disabled={disabled || scrubbing}
            onClick={onScrub}
            title="Overwrite this site's deployed secrets with a placeholder now"
          >
            {scrubbing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Eraser className="size-3.5" />
            )}
            Scrub now
          </Button>
        )}
      </div>

      {/* Named, with Harness's reason. "Two failed" is not something anybody can
          act on; "this secret, because somebody edited it" is. */}
      {scrub.problems.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {scrub.problems.map((problem) => (
            <li
              key={`${problem.orgIdentifier}:${problem.secretIdentifier}`}
              className="flex flex-wrap items-baseline gap-x-1.5"
            >
              <code className="font-mono text-foreground">
                {problem.secretIdentifier}
              </code>
              <span
                className={
                  problem.status === "failed"
                    ? "text-destructive"
                    : "text-amber-600 dark:text-amber-500"
                }
              >
                {problem.status === "failed" ? "failed" : "left alone"}
              </span>
              {problem.note && <span className="w-full">{problem.note}</span>}
            </li>
          ))}
        </ul>
      )}

      {/* Only what the button just did. The counts above are the durable record
          and come back from the server; this is the acknowledgement. */}
      {run && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <span>
            {run.scrubbed} scrubbed
            {run.skipped > 0 && <>, {run.skipped} left alone</>}
            {run.failed > 0 && (
              <span className="text-destructive">, {run.failed} failed</span>
            )}
            {run.scrubbed + run.skipped + run.failed === 0 && (
              <>Nothing left to scrub.</>
            )}
          </span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="transition-colors hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </p>
      )}
    </div>
  );
}

/** How each outcome reads, and how it is coloured. */
const OUTCOME: Record<DeployOutcome, { label: string; className: string }> = {
  created: { label: "created", className: "text-brand" },
  existed: { label: "already there", className: "text-muted-foreground" },
  failed: { label: "failed", className: "text-destructive" },
  skipped: { label: "skipped", className: "text-amber-600 dark:text-amber-500" },
};

/**
 * What the deploy did, entity by entity.
 *
 * Every line is shown rather than only the failures, and in the order the deploy
 * went in. A deploy is somebody's first look at an organization they cannot see
 * yet, and "forty created, two failed" with the two named is a different thing
 * from a list of two errors: the first says what is now in Harness, and that is
 * the question being asked.
 *
 * Scrolls rather than paginates. It is a log, it is read top to bottom once, and
 * it is thrown away by the close button.
 */
function DeployReportPanel({
  report,
  onClose,
}: {
  report: DeployReport;
  onClose: () => void;
}) {
  const { counts } = report;

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-medium text-foreground">
          {report.orgName}
        </span>
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-muted-foreground">
          {report.orgIdentifier}
        </code>
        <a
          href={report.orgUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-brand hover:underline"
        >
          Open in Harness
          <ExternalLink className="size-3" />
        </a>

        {/* Only the counts that happened. A row of three zeroes reads as three
            problems somebody has to check. */}
        <span className="ml-auto flex items-center gap-2 text-muted-foreground">
          {(Object.keys(OUTCOME) as DeployOutcome[])
            .filter((outcome) => counts[outcome] > 0)
            .map((outcome) => (
              <span key={outcome} className={OUTCOME[outcome].className}>
                {counts[outcome]} {OUTCOME[outcome].label}
              </span>
            ))}
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss this report"
            className="transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Read from {report.sources} template source
        {report.sources === 1 ? "" : "s"}.
        {counts.failed > 0 && (
          <>
            {" "}
            Nothing was rolled back — the organization is there with everything
            that did land, so the fix is usually to correct the cause and deploy
            into a new one, or finish it by hand in Harness.
          </>
        )}
      </p>

      <ul className="max-h-72 space-y-0.5 overflow-y-auto text-xs">
        {report.steps.map((step, i) => (
          <li
            key={i}
            className="flex flex-wrap items-baseline gap-x-2 border-b border-border/40 py-1 last:border-b-0"
          >
            <span className="w-24 shrink-0 text-muted-foreground">
              {step.kind}
            </span>
            <code className="font-mono text-foreground">{step.identifier}</code>
            <span className="text-muted-foreground">in {step.scope}</span>
            <span className={cn("ml-auto shrink-0", OUTCOME[step.outcome].className)}>
              {OUTCOME[step.outcome].label}
            </span>
            {step.detail && (
              // Full width beneath the line rather than truncated into it: this
              // is Harness's own sentence about why, and it is the only thing on
              // the page that can tell somebody what to change.
              <span className="w-full text-muted-foreground">{step.detail}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
