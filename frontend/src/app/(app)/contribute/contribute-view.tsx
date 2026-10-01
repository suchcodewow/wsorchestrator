"use client";

/** The contributor page: the bundle, its tokens, and what you have proposed. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Download,
  FileCode,
  KeyRound,
  Loader2,
  Plug,
  TriangleAlert,
} from "lucide-react";
import { ApiTokensCard } from "@/components/api-tokens-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

const STATUS_TINT: Record<string, string> = {
  testing: "text-muted-foreground",
  submitted: "text-brand",
  approved: "text-brand",
  rejected: "text-destructive",
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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <motion.div variants={riseChild}>
        <h1 className="text-3xl font-medium tracking-tight">Contribute</h1>
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
        <ApiTokensCard
          tokens={tokens}
          intro={
            <p className="text-sm text-muted-foreground">
              The download already includes one, so this is only for a second
              machine or for CI.
            </p>
          }
          usage={
            <>
              Then:{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                export WORKSHOP_API_TOKEN=&quot;…&quot;
              </code>
            </>
          }
        />
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
