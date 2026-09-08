"use client";

/** The contributor page: the bundle, its tokens, and what you have proposed. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Check,
  Copy,
  Download,
  FileCode,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MAX_TOKENS_PER_USER, TOKEN_NAME_MAX } from "@/db/schema";
import type { TokenSummary } from "@/lib/api-tokens";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

type SetSummary = {
  id: string;
  name: string;
  status: string;
  notes: string;
  authorId: string | null;
  updatedAt: string;
  componentCount: number;
  runCount: number;
};

type Minted = { prefix: string; token: string };

const STATUS_TINT: Record<string, string> = {
  testing: "text-muted-foreground",
  submitted: "text-brand",
  approved: "text-brand",
  rejected: "text-destructive",
};

const TOKEN_TINT: Record<TokenSummary["status"], string> = {
  active: "text-brand",
  expired: "text-muted-foreground",
  revoked: "text-muted-foreground",
};

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

type CatalogEntry = {
  identifier: string;
  kind: string;
  name: string;
  description: string;
  versionLabel: string;
  builtin: boolean;
  requires: string[];
  dependsOn: string[];
  usedBy: string[];
};

const KIND_ORDER = ["secret_text", "secret_file", "connector", "template"];

const KIND_LABEL: Record<string, string> = {
  secret_text: "Secrets",
  secret_file: "Secrets",
  connector: "Connectors",
  template: "Templates",
};

const KIND_ICON: Record<string, typeof KeyRound> = {
  secret_text: KeyRound,
  secret_file: KeyRound,
  connector: Plug,
  template: FileCode,
};

export function ContributeView({
  tokens,
  catalog,
  sets,
  canReview,
  mine,
}: {
  tokens: TokenSummary[];
  catalog: CatalogEntry[];
  sets: SetSummary[];
  canReview: boolean;
  mine: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<Minted | null>(null);
  const [copied, setCopied] = useState(false);

  const activeManual = tokens.filter(
    (t) => t.status === "active" && t.source === "manual",
  );
  const hasBundleToken = tokens.some(
    (t) => t.status === "active" && t.source === "bundle",
  );

  async function call(
    key: string,
    path: string,
    init: RequestInit,
  ): Promise<unknown | null> {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (body as { message?: string })?.message ?? `Request failed (${res.status})`,
        );
      }
      return body;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function createToken() {
    if (name.trim().length === 0) return;
    const body = (await call("mint", "/api/tokens", {
      method: "POST",
      body: JSON.stringify({ name: name.trim() }),
    })) as { token?: Minted } | null;

    if (body?.token) {
      setMinted({ prefix: body.token.prefix, token: body.token.token });
      setName("");
      setCopied(false);
      router.refresh();
    }
  }

  async function revoke(id: string) {
    if (await call(id, `/api/tokens/${id}`, { method: "DELETE" })) {
      router.refresh();
    }
  }

  async function review(id: string, approve: boolean) {
    if (
      await call(id, `/api/component-sets/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ approve }),
      })
    ) {
      router.refresh();
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setError("Could not copy — select the token and copy it manually.");
    }
  }

  const submitted = sets.filter((s) => s.status === "submitted");

  const grouped = KIND_ORDER.reduce<Array<[string, CatalogEntry[]]>>((acc, kind) => {
    const entries = catalog.filter((c) => c.kind === kind);
    if (entries.length === 0) return acc;
    const label = KIND_LABEL[kind]!;
    const existing = acc.find(([l]) => l === label);
    if (existing) existing[1].push(...entries);
    else acc.push([label, entries]);
    return acc;
  }, []);

  return (
    <motion.div
      variants={staggerParent(0.05)}
      initial="hidden"
      animate="show"
      className="space-y-8"
    >
      <motion.div variants={riseChild} className="space-y-1.5">
        <h1 className="text-3xl font-medium tracking-tight">Contribute</h1>
        <p className="text-muted-foreground">
          Add Harness secrets, connectors, and templates to what every workshop
          gets.
        </p>
      </motion.div>

      {error && (
        <motion.div variants={riseChild}>
          <Card className="border-destructive/40">
            <CardContent className="flex items-start gap-2.5 py-4 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>{error}</span>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <motion.div variants={riseChild} className="space-y-3">
        <h2 className="text-sm font-medium">1. Get the bundle</h2>
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div className="space-y-1 text-sm">
              <p>
                A Claude Code skill holding all {catalog.length} published
                component{catalog.length === 1 ? "" : "s"} and a token of your
                own.
              </p>
              <p className="text-muted-foreground">
                Unzip into{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  .claude/skills/
                </code>{" "}
                and tell Claude what you want to add.
              </p>
              {hasBundleToken && (
                <p className="text-muted-foreground">
                  Downloading again issues a new token and revokes the one in
                  your last download.
                </p>
              )}
            </div>
            <Button asChild>
              <a href="/api/components/bundle">
                <Download className="size-4" />
                Download
              </a>
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={riseChild} className="space-y-3">
        <h2 className="text-sm font-medium">2. Tokens</h2>
        <Card>
          <CardContent className="space-y-4 py-5">
            <p className="text-sm text-muted-foreground">
              The download already includes one, so this is only for a second
              machine or for CI.
            </p>

            {minted && (
              <div className="space-y-2 rounded-md border border-brand/40 bg-brand/5 p-3">
                <p className="text-sm font-medium">
                  Copy this now — it will not be shown again.
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-xs">
                    {minted.token}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copy(minted.token)}
                  >
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Then:{" "}
                  <code className="rounded bg-muted px-1 py-0.5">
                    export WORKSHOP_API_TOKEN=&quot;…&quot;
                  </code>
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={name}
                maxLength={TOKEN_NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createToken()}
                placeholder="What is it for? e.g. laptop"
                className="max-w-64"
                disabled={activeManual.length >= MAX_TOKENS_PER_USER}
              />
              <Button
                onClick={createToken}
                disabled={
                  busy === "mint" ||
                  name.trim().length === 0 ||
                  activeManual.length >= MAX_TOKENS_PER_USER
                }
              >
                {busy === "mint" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Create
              </Button>
              {activeManual.length >= MAX_TOKENS_PER_USER && (
                <span className="text-sm text-muted-foreground">
                  {MAX_TOKENS_PER_USER} active tokens is the limit — revoke one
                  first.
                </span>
              )}
            </div>

            {tokens.length > 0 && (
              <div className="divide-y divide-border/70 border-t border-border/70 text-sm">
                {tokens.map((t) => (
                  <div
                    key={t.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
                  >
                    <span className="font-medium">{t.name}</span>
                    {t.source === "bundle" && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        in a download
                      </span>
                    )}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-muted-foreground">
                      {t.prefix}…
                    </code>
                    <span className={cn("text-xs", TOKEN_TINT[t.status])}>
                      {t.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t.status === "revoked"
                        ? "revoked"
                        : `expires ${shortDate(t.expiresAt)}`}
                      {" · "}
                      {t.lastUsedAt
                        ? `last used ${shortDate(t.lastUsedAt)}`
                        : "never used"}
                    </span>
                    {t.status === "active" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto text-muted-foreground hover:text-destructive"
                        onClick={() => revoke(t.id)}
                        disabled={busy === t.id}
                      >
                        {busy === t.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                        Revoke
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={riseChild} className="space-y-3">
        <h2 className="text-sm font-medium">3. What every workshop gets</h2>
        <Card>
          <CardContent className="space-y-5 py-5 text-sm">
            {catalog.length === 0 ? (
              <p className="text-muted-foreground">
                No components are deployed into workshops yet.
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">
                  The build order is worked out from the{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">
                    org.&lt;name&gt;
                  </code>{" "}
                  references inside each component.
                </p>

                {grouped.map(([label, entries]) => {
                  const Icon = KIND_ICON[entries[0]!.kind]!;
                  return (
                    <div key={label} className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Icon className="size-3.5" />
                        {label}
                      </div>
                      <div className="divide-y divide-border/70 border-t border-border/70">
                        {entries.map((c) => (
                          <div key={c.identifier} className="space-y-1 py-2.5">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <code className="font-mono text-xs">
                                {c.identifier}
                              </code>
                              <span className="text-muted-foreground">
                                {c.name}
                              </span>
                              {c.kind === "template" && (
                                <span className="text-xs text-muted-foreground">
                                  v{c.versionLabel}
                                </span>
                              )}
                              {!c.builtin && (
                                <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand">
                                  contributed
                                </span>
                              )}
                            </div>
                            {c.description && (
                              <p className="text-xs text-muted-foreground">
                                {c.description}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                              {c.dependsOn.length > 0 && (
                                <span>after {c.dependsOn.join(", ")}</span>
                              )}
                              {c.usedBy.length > 0 && (
                                <span>used by {c.usedBy.join(", ")}</span>
                              )}
                              {c.requires.length > 0 && (
                                <span>needs {c.requires.join(", ")}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={riseChild} className="space-y-3">
        <h2 className="text-sm font-medium">
          {canReview ? "4. Proposals" : "4. Your proposals"}
        </h2>
        <Card>
          <CardContent className="py-5 text-sm">
            {sets.length === 0 ? (
              <p className="text-muted-foreground">
                Nothing yet &mdash; run{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  node scripts/sandbox.mjs
                </code>{" "}
                from the bundle and a set will appear here.
              </p>
            ) : (
              <div className="divide-y divide-border/70">
                {sets.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span className="font-medium">{s.name}</span>
                    <span className={cn("text-xs", STATUS_TINT[s.status])}>
                      {s.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {s.componentCount} component
                      {s.componentCount === 1 ? "" : "s"}
                      {" · "}
                      {s.runCount === 0 ? (
                        <span className="text-destructive">never tested</span>
                      ) : (
                        `${s.runCount} sandbox run${s.runCount === 1 ? "" : "s"}`
                      )}
                      {" · "}
                      {shortDate(s.updatedAt)}
                    </span>

                    {canReview && s.status === "submitted" && (
                      <div className="ml-auto flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => review(s.id, false)}
                          disabled={busy === s.id}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => review(s.id, true)}
                          disabled={busy === s.id}
                        >
                          {busy === s.id && (
                            <Loader2 className="size-4 animate-spin" />
                          )}
                          Publish
                        </Button>
                      </div>
                    )}
                    {s.authorId !== mine && canReview && (
                      <span className="text-xs text-muted-foreground">
                        someone else&apos;s
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {canReview && submitted.length > 0 && (
        <motion.div variants={riseChild}>
          <Card className="border-brand/40">
            <CardContent className="py-4 text-sm">
              <p>
                {submitted.length} set{submitted.length === 1 ? "" : "s"} waiting
                on you, and publishing deploys them into{" "}
                <strong>every workshop</strong>.{" "}
                <Link href="/events" className="text-brand underline">
                  Open the sandbox runs
                </Link>
              </p>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </motion.div>
  );
}
