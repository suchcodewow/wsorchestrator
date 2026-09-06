"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MAX_TEMPLATE_SOURCES } from "@/db/schema";
import type { HarnessScope } from "@/lib/harness-platform";
import { messageFor } from "@/lib/harness-template-errors";
import type { SourceStatus, TemplateSourceRow } from "@/lib/harness-templates";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/** How a scope reads in a picker and in the table: name, then its identifier. */
const scopeLabel = (name: string | null, identifier: string) =>
  name && name !== identifier ? `${name} (${identifier})` : identifier;

export function TemplatesView({
  sources,
  status,
  baseUrl,
  configured,
}: {
  sources: TemplateSourceRow[];
  /** The live check for each row, by id — see the page. */
  status: Record<string, SourceStatus>;
  baseUrl: string;
  /** Whether an encryption key exists. Without one nothing can be saved. */
  configured: boolean;
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [reveal, setReveal] = useState(false);
  /** Null until the token has been loaded — which is what gates the pickers. */
  const [orgs, setOrgs] = useState<HarnessScope[] | null>(null);
  const [org, setOrg] = useState("");
  const [projects, setProjects] = useState<HarnessScope[] | null>(null);
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const full = sources.length >= MAX_TEMPLATE_SOURCES;

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

  /**
   * Everything downstream of the token, cleared. Called when the token is
   * edited: organizations loaded for the old paste say nothing about the new
   * one, and leaving them on screen would let somebody save a scope that was
   * never checked against the token they are saving it with.
   */
  function resetScopes() {
    setOrgs(null);
    setOrg("");
    setProjects(null);
    setProject("");
  }

  /** Step one: what can this token see? */
  async function load() {
    if (token.trim().length === 0) return;
    resetScopes();
    const body = await call("load", "/api/settings/templates/lookup", {
      method: "POST",
      body: JSON.stringify({ token: token.trim() }),
    });
    if (!body) return;

    const scopes = body.scopes as HarnessScope[];
    setOrgs(scopes);
    if (scopes.length === 0) {
      setError("That token works, but it can't see any organizations.");
      return;
    }
    // Not auto-selected even when there is only one: the point of this step is
    // that an administrator chooses the org, and a pre-filled single option is
    // a choice nobody made.
    setSaved(
      `${scopes.length} organization${scopes.length === 1 ? "" : "s"} visible to this token.`,
    );
  }

  /** Step two, on choosing an org: what projects are in it? */
  async function pickOrg(identifier: string) {
    setOrg(identifier);
    setProjects(null);
    setProject("");
    if (identifier.length === 0) return;

    const body = await call("projects", "/api/settings/templates/lookup", {
      method: "POST",
      body: JSON.stringify({ token: token.trim(), org: identifier }),
    });
    // A failure leaves `projects` null, which reads as "not loaded" — the org is
    // still chosen and can still be saved on its own, which is a legitimate
    // source and the right thing to fall back to.
    if (body) setProjects(body.scopes as HarnessScope[]);
  }

  async function save() {
    if (org.length === 0 || full) return;
    const body = await call("save", "/api/settings/templates", {
      method: "POST",
      body: JSON.stringify({
        token: token.trim(),
        org,
        project: project || null,
      }),
    });
    if (!body) return;

    const added = body.source as TemplateSourceRow;
    setToken("");
    setReveal(false);
    resetScopes();
    setSaved(
      `Saved ${scopeLabel(added.orgName, added.orgIdentifier)}${
        added.projectIdentifier
          ? ` / ${scopeLabel(added.projectName, added.projectIdentifier)}`
          : ""
      }.`,
    );
    router.refresh();
  }

  async function remove(id: string) {
    if (await call(id, `/api/settings/templates/${id}`, { method: "DELETE" })) {
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
        <h2 className="text-xl font-medium tracking-tight">Templates</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The Harness organizations this site may read templates from. Paste a
          token and load it: the organizations it can see on{" "}
          <span className="font-mono text-xs">{baseUrl}</span> are offered, then
          the projects inside whichever one you pick. A project is optional —
          leave it as the whole organization if that is what you want. Tokens are
          stored encrypted and never shown again.
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
            safely. Set <code>AUTH_SECRET</code> or{" "}
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

      {/* Add a source: token, then org, then optionally project. Each step only
          appears once the one before it has an answer, so the form reads as the
          sequence it is rather than as four controls waiting on each other. */}
      <motion.div variants={riseChild}>
        <Card>
          <CardContent className="space-y-3 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-64 flex-1">
                <Input
                  // A password field by default: this is a live credential, and
                  // it is pasted more often than typed. The reveal is there for
                  // the one case that matters — checking a paste Harness just
                  // rejected.
                  type={reveal ? "text" : "password"}
                  value={token}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="pat.xxxxx.xxxxx.xxxxx"
                  aria-label="Harness token"
                  disabled={!configured || full}
                  className="pr-10 font-mono"
                  onChange={(e) => {
                    setToken(e.target.value);
                    resetScopes();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") load();
                  }}
                />
                <button
                  type="button"
                  aria-label={reveal ? "Hide token" : "Show token"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setReveal((r) => !r)}
                >
                  {reveal ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              <Button
                variant="outline"
                disabled={
                  token.trim().length === 0 || busy !== null || !configured || full
                }
                onClick={load}
              >
                {busy === "load" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Load
              </Button>
            </div>

            {orgs !== null && orgs.length > 0 && (
              <div className="flex flex-wrap items-end gap-3">
                <ScopePicker
                  label="Organization"
                  value={org}
                  placeholder="Choose an organization"
                  scopes={orgs}
                  busy={busy === "projects"}
                  onChange={pickOrg}
                />

                {org.length > 0 && (
                  <ScopePicker
                    label="Project (optional)"
                    value={project}
                    placeholder={
                      projects === null
                        ? "Couldn't list projects — the whole org"
                        : projects.length === 0
                          ? "No projects — the whole org"
                          : "The whole organization"
                    }
                    scopes={projects ?? []}
                    busy={false}
                    onChange={setProject}
                  />
                )}

                <Button
                  variant="brand"
                  disabled={org.length === 0 || busy !== null}
                  onClick={save}
                >
                  {busy === "save" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Save
                </Button>
              </div>
            )}

            {full && (
              <p className="text-xs text-muted-foreground">
                The site holds as many template sources as it can (
                {MAX_TEMPLATE_SOURCES}). Remove one to add another.
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        variants={riseChild}
        className="overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="w-16 px-5 py-2.5 font-medium">Works</th>
                <th className="px-5 py-2.5 font-medium">Organization</th>
                <th className="px-5 py-2.5 font-medium">Project</th>
                <th className="px-5 py-2.5 font-medium">Token</th>
                <th className="px-5 py-2.5 font-medium">Added</th>
                <th className="w-16 px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {sources.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-8 text-center text-muted-foreground"
                  >
                    No template sources yet.
                  </td>
                </tr>
              )}

              {sources.map((row) => {
                const state = status[row.id];
                return (
                  <tr
                    key={row.id}
                    className="border-b transition-colors last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-5 py-3">
                      <StatusMark row={row} status={state} />
                    </td>
                    <td className="px-5 py-3 font-medium">
                      {scopeLabel(row.orgName, row.orgIdentifier)}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {row.accountName ?? row.accountId}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {row.projectIdentifier
                        ? scopeLabel(row.projectName, row.projectIdentifier)
                        : "The whole organization"}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                      …{row.tail}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {shortDate(row.createdAt)}
                      {row.addedBy && (
                        <span className="block text-xs">{row.addedBy}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${row.orgIdentifier}`}
                          disabled={busy === row.id}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => remove(row.id)}
                        >
                          {busy === row.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * One scope picker. A native `<select>` because that is what a list of thirty
 * organizations wants on a phone as much as on a desktop, and this app has no
 * combobox to reach for.
 *
 * The empty option is meaningful in both uses: for the organization it is "not
 * chosen yet", and for the project it is "the whole organization" — which is why
 * the placeholder is the caller's to word.
 */
function ScopePicker({
  label,
  value,
  placeholder,
  scopes,
  busy,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  scopes: HarnessScope[];
  busy: boolean;
  onChange: (identifier: string) => void;
}) {
  return (
    <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        {label}
        {busy && <Loader2 className="size-3 animate-spin" />}
      </span>
      <select
        value={value}
        disabled={scopes.length === 0}
        onChange={(e) => onChange(e.target.value)}
        // Matches the Input primitive's shell so the row reads as one form.
        className={cn(
          "h-9 w-full rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs transition-colors",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <option value="">{placeholder}</option>
        {scopes.map((scope) => (
          <option key={scope.identifier} value={scope.identifier}>
            {scopeLabel(scope.name, scope.identifier)}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The tick or the cross, and what it means on hover.
 *
 * The three findings are reported separately because they fail for different
 * reasons and want different fixes — a revoked token is pasted again, a deleted
 * org means the row should go, a moved project means it should be re-added. One
 * boolean would send somebody to the wrong one.
 */
function StatusMark({
  row,
  status,
}: {
  row: TemplateSourceRow;
  status: SourceStatus | undefined;
}) {
  if (!status) {
    return <span className="text-muted-foreground">—</span>;
  }

  const reasons = [
    status.tokenOk ? null : "Harness rejected the stored token.",
    status.orgOk ? null : `The organization ${row.orgIdentifier} isn't there, or this token can't see it.`,
    status.projectOk === false
      ? `The project ${row.projectIdentifier} isn't there, or this token can't see it.`
      : null,
    status.detail ? `Harness said: ${status.detail}` : null,
  ].filter((r): r is string => r !== null);

  return (
    <span
      // The reasons are the title rather than a column of their own: the table
      // is already six columns wide, and this is a sentence, not a field.
      title={status.ok ? "Checked when this page loaded — all of it works." : reasons.join(" ")}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-full",
        status.ok
          ? "bg-brand/10 text-brand"
          : "bg-destructive/10 text-destructive",
      )}
      role="img"
      aria-label={status.ok ? "Working" : reasons.join(" ")}
    >
      {status.ok ? <Check className="size-4" /> : <X className="size-4" />}
    </span>
  );
}
