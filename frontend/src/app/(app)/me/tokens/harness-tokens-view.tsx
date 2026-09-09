"use client";

/** The saved Harness tokens, and the deploy and scrub actions on each. */

import { Fragment, useState, type ReactNode } from "react";
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
  Layers,
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
import type { DeployChoices } from "@/lib/harness-deploy-choices";
import { messageFor as deployMessageFor } from "@/lib/harness-deploy-errors";
import {
  nothingSelected,
  type DeployedContent,
  type DeploySelection,
} from "@/lib/harness-deploy-selection";
import { harnessIdentifier } from "@/lib/harness-identifier";
import { messageFor } from "@/lib/harness-token-errors";
import { administersAccount, permissionLabel } from "@/lib/harness-permissions";
import type { ScrubRun, ScrubSummary } from "@/lib/harness-scrub";
import type { TemplateSourceRow } from "@/lib/harness-templates";
import type { HarnessTokenSummary } from "@/lib/harness-tokens";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const stamp = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function until(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "any moment now";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

const hasScrubRecord = (s: ScrubSummary) =>
  s.pending + s.scrubbed + s.skipped + s.failed > 0;

const PRINCIPAL_LABEL: Record<string, string> = {
  USER: "Personal token",
  SERVICE_ACCOUNT: "Service account",
};

const tokenName = (t: HarnessTokenSummary) => t.accountName ?? t.accountId;

const countOf = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** The place a template source reads from, as short as it can be said. */
const sourceLabel = (s: TemplateSourceRow) =>
  s.projectIdentifier === null
    ? (s.orgName ?? s.orgIdentifier)
    : `${s.orgName ?? s.orgIdentifier} / ${s.projectName ?? s.projectIdentifier}`;

export function HarnessTokensView({
  tokens,
  choices,
  baseUrl,
  configured,
  canDeploy,
  scrubDays,
}: {
  tokens: HarnessTokenSummary[];
  choices: DeployChoices;
  baseUrl: string;
  configured: boolean;
  scrubDays: number;
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
    setToken("");
    setReveal(false);
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

    const scrub = body.scrub as ScrubRun | null;
    if (scrub && scrub.problems.length > 0) {
      setError(
        `Token removed, but ${scrub.problems.length} of this site's secrets ` +
          `need removing in Harness by hand: ${scrub.problems
            .map((p) => p.secretIdentifier)
            .join(", ")}.`,
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

  async function scrub(id: string): Promise<ScrubRun | null> {
    const body = await call(`scrub:${id}`, `/api/me/harness-tokens/${id}/scrub`, {
      method: "POST",
    });
    if (!body) return null;
    router.refresh();
    return body.run as ScrubRun;
  }

  async function deploy(
    id: string,
    org: string,
    selection: DeploySelection,
  ): Promise<DeployReport | null> {
    setBusy(`deploy:${id}`);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(`/api/me/harness-tokens/${id}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org, ...selection }),
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
      router.refresh();
      return body.report;
    } catch {
      setError(
        "Lost contact with the server while deploying — check the organization in Harness first.",
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
          encrypted.
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
            safely.
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

      <motion.div variants={riseChild}>
        <Card>
          <CardContent className="space-y-3 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-64 flex-1">
                <Input
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
                <>Nothing else to fill in — the account comes from the token.</>
              )}
            </p>
          </CardContent>
        </Card>
      </motion.div>

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
                choices={choices}
                busy={busy === t.id}
                deploying={busy === `deploy:${t.id}`}
                scrubbing={busy === `scrub:${t.id}`}
                canDeploy={canDeploy && administersAccount(t.permissions)}
                expanded={expanded === t.id}
                onToggle={() =>
                  setExpanded((current) => (current === t.id ? null : t.id))
                }
                onRecheck={() => recheck(t.id)}
                onRemove={() => remove(t.id)}
                scrubDays={scrubDays}
                onDeploy={(org, selection) => deploy(t.id, org, selection)}
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
  choices,
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
  choices: DeployChoices;
  busy: boolean;
  deploying: boolean;
  scrubbing: boolean;
  canDeploy: boolean;
  scrubDays: number;
  expanded: boolean;
  onToggle: () => void;
  onRecheck: () => void;
  onRemove: () => void;
  onDeploy: (
    org: string,
    selection: DeploySelection,
  ) => Promise<DeployReport | null>;
  onScrub: () => Promise<ScrubRun | null>;
}) {
  const granted = token.permissions.filter((p) => p.permitted).length;
  const checked = token.permissions.length;
  const name = tokenName(token);

  const [prompting, setPrompting] = useState(false);
  const [org, setOrg] = useState(token.lastDeploy?.orgName ?? "");
  const [report, setReport] = useState<DeployReport | null>(null);

  // Everything the site and this account hold starts ticked, which is what a
  // deploy used to send before any of this could be chosen — bar a source whose
  // token no longer opens, since ticking that only buys a skipped step.
  const [selection, setSelection] = useState<DeploySelection>({
    official: choices.official.secrets + choices.official.sources > 0,
    mySecrets: choices.mySecrets > 0,
    myTemplates: choices.myTemplates.filter((s) => s.usable).map((s) => s.id),
  });

  const identifier = harnessIdentifier(org);

  const rerun =
    identifier !== null &&
    identifier.toLowerCase() ===
      token.lastDeploy?.orgIdentifier.toLowerCase();

  const [scrubbed, setScrubbed] = useState<ScrubRun | null>(null);

  const empty = nothingSelected(selection);

  const secretsGoing =
    (selection.official && choices.official.secrets > 0) ||
    (selection.mySecrets && choices.mySecrets > 0);

  const toggleTemplate = (id: string) =>
    setSelection((current) => ({
      ...current,
      myTemplates: current.myTemplates.includes(id)
        ? current.myTemplates.filter((other) => other !== id)
        : [...current.myTemplates, id],
    }));

  async function submit() {
    if (identifier === null || deploying || empty) return;
    const result = await onDeploy(org, selection);
    if (!result) return;
    setPrompting(false);
    setReport(result);
  }

  // Anything under the row shares its padding, so the row itself keeps the
  // whole cell to click on when there is nothing below it.
  const body = expanded || prompting || report !== null;

  return (
    <div>
      <div
        className={cn(
          "group/row relative px-5 transition-colors hover:bg-muted/30",
          body ? "pb-2 pt-4" : "py-4",
        )}
      >
        {/* Sits under the row so every part of the cell toggles it, including
            the padding — the buttons above take their own clicks back. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? `Hide the details for ${name}`
              : `Show everything about ${name}`
          }
          className="absolute inset-0 cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
        />

        <div className="pointer-events-none relative flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover/row:text-foreground" />
          )}
          <span className="min-w-0 truncate font-medium">{name}</span>
          {token.accountName !== null && (
            <code className="truncate rounded bg-muted px-1 py-0.5 font-mono text-xs text-muted-foreground">
              {token.accountId}
            </code>
          )}
          {!token.usable && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-destructive">
              <AlertTriangle className="size-3.5" />
              can&apos;t be decrypted — paste it again
            </span>
          )}

          <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-1">
            {canDeploy && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={busy || deploying || !token.usable}
                onClick={() => setPrompting((open) => !open)}
                title="Create a Harness org and pick what to fill it with"
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
      </div>

      {body && (
        <div className="space-y-2 px-5 pb-4">
          {prompting && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {rerun ? (
                  <>
                    Into{" "}
                    <span className="font-medium text-foreground">
                      {token.lastDeploy?.orgName}
                    </span>{" "}
                    again, leaving anything already there as it is.
                  </>
                ) : (
                  <>
                    A new organization in{" "}
                    <span className="font-medium text-foreground">{name}</span>,
                    filled with whatever is ticked below.
                  </>
                )}
              </p>

              <DeployPicker
                choices={choices}
                selection={selection}
                disabled={deploying}
                onOfficial={(on) =>
                  setSelection((current) => ({ ...current, official: on }))
                }
                onMySecrets={(on) =>
                  setSelection((current) => ({ ...current, mySecrets: on }))
                }
                onTemplate={toggleTemplate}
              />

              {secretsGoing && (
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
                  .
                </p>
              )}

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
                  disabled={identifier === null || deploying || empty}
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
                    <>That name needs a letter, digit, or underscore in it.</>
                  )
                ) : empty ? (
                  <>Tick at least one thing above to deploy.</>
                ) : (
                  <>
                    Harness identifier:{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono">
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

          {expanded && (
            <div className="space-y-2 border-l pl-4 ml-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {[
                  PRINCIPAL_LABEL[token.principalType ?? ""] ??
                    (token.kind === "sat" ? "Service account" : "Personal token"),
                  token.accountName === null ? (
                    <code className="font-mono">{token.accountId}</code>
                  ) : null,
                  token.principal,
                  <code key="tail" className="font-mono">
                    …{token.tail}
                  </code>,
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

              {token.lastDeploy ? (
                <>
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
                    {token.lastDeploy.orgIdentifier !== token.lastDeploy.orgName && (
                      <code className="rounded bg-muted px-1 py-0.5 font-mono">
                        {token.lastDeploy.orgIdentifier}
                      </code>
                    )}
                    <span>·</span>
                    <time dateTime={token.lastDeploy.at}>
                      {stamp(token.lastDeploy.at)}
                    </time>
                  </div>

                  <DeployedContentLine content={token.lastDeploy.content} />
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Never deployed with.
                </p>
              )}

              <DeployedCredentials
                scrub={token.scrub}
                scrubbing={scrubbing}
                disabled={busy || deploying || !token.usable}
                run={scrubbed}
                onScrub={async () => setScrubbed(await onScrub())}
                onDismiss={() => setScrubbed(null)}
              />

              <div className="space-y-1 pt-0.5">
                <p className="text-xs text-muted-foreground">
                  {checked === 0
                    ? "No permission check recorded"
                    : `${granted} of ${checked} checked permissions granted`}
                </p>
                <ul className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
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
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** What the last deploy put into the organization, as far as it was recorded. */
function DeployedContentLine({
  content,
}: {
  content: DeployedContent | null;
}) {
  if (content === null) {
    return (
      <p className="text-xs text-muted-foreground">
        That deploy ran before this site kept a record of what went in.
      </p>
    );
  }

  const parts = [
    ...(content.official ? ["Official content"] : []),
    ...(content.mySecrets ? ["My secrets"] : []),
    ...content.myTemplates,
  ];

  if (parts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nothing landed in that organization — every ticked source was skipped.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <Layers className="size-3.5 shrink-0" />
      <span>Holding</span>
      {parts.map((part) => (
        <span
          key={part}
          className="rounded-full bg-muted px-1.5 py-0.5 text-foreground"
        >
          {part}
        </span>
      ))}
    </div>
  );
}

/** One tick, with a sentence under it saying what it stands for. */
function Tick({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: ReactNode;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-2.5 rounded-md px-2 py-1.5 text-xs",
        disabled ? "opacity-60" : "cursor-pointer hover:bg-muted/60",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-3.5 shrink-0 accent-brand"
      />
      <span>
        <span className="font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block leading-relaxed text-muted-foreground">
          {hint}
        </span>
      </span>
    </label>
  );
}

/** What to deploy: the site's content, this account's secrets, its templates. */
function DeployPicker({
  choices,
  selection,
  disabled,
  onOfficial,
  onMySecrets,
  onTemplate,
}: {
  choices: DeployChoices;
  selection: DeploySelection;
  disabled: boolean;
  onOfficial: (on: boolean) => void;
  onMySecrets: (on: boolean) => void;
  onTemplate: (id: string) => void;
}) {
  const { official } = choices;
  const nothingOfficial = official.secrets + official.sources === 0;

  return (
    <div className="space-y-0.5 rounded-lg border bg-background/60 p-1.5">
      <Tick
        label="Official content"
        hint={
          nothingOfficial ? (
            <>This site holds no org secrets or template sources of its own.</>
          ) : (
            <>
              {countOf(official.secrets, "org secret")} and everything in{" "}
              {countOf(official.sources, "template source")} this site holds.
            </>
          )
        }
        checked={selection.official}
        disabled={disabled || nothingOfficial}
        onChange={onOfficial}
      />

      <Tick
        label="My secrets"
        hint={
          choices.mySecrets === 0 ? (
            <>
              You keep no org secrets of your own — add them in My settings → My
              org secrets.
            </>
          ) : (
            <>
              {countOf(choices.mySecrets, "org secret")} of your own, written
              into the organization. One named the same as an official secret
              wins.
            </>
          )
        }
        checked={selection.mySecrets}
        disabled={disabled || choices.mySecrets === 0}
        onChange={onMySecrets}
      />

      {choices.myTemplates.length === 0 ? (
        <p className="px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
          You keep no template sources of your own — add one in My settings → My
          templates to copy an organization&apos;s content in.
        </p>
      ) : (
        <>
          <p className="px-2 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            My templates
          </p>
          {choices.myTemplates.map((source) => (
            <Tick
              key={source.id}
              label={sourceLabel(source)}
              hint={
                source.usable ? (
                  <>
                    Copy every connector, template, environment, and
                    infrastructure from{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono">
                      {source.projectIdentifier === null
                        ? source.orgIdentifier
                        : `${source.orgIdentifier}/${source.projectIdentifier}`}
                    </code>{" "}
                    in {source.accountName ?? source.accountId}.
                  </>
                ) : (
                  <>
                    Its token can no longer be decrypted — re-add it in My
                    settings → My templates.
                  </>
                )
              }
              checked={selection.myTemplates.includes(source.id)}
              disabled={disabled}
              onChange={() => onTemplate(source.id)}
            />
          ))}
        </>
      )}
    </div>
  );
}

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

const OUTCOME: Record<DeployOutcome, { label: string; className: string }> = {
  created: { label: "created", className: "text-brand" },
  existed: { label: "already there", className: "text-muted-foreground" },
  failed: { label: "failed", className: "text-destructive" },
  skipped: { label: "skipped", className: "text-amber-600 dark:text-amber-500" },
};

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
            Nothing was rolled back, so whatever did land is still in the
            organization.
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
              <span className="w-full text-muted-foreground">{step.detail}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
