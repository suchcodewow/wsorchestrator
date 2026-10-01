"use client";

/** Your personal access tokens: create one, see them all, revoke one. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MAX_TOKENS_PER_USER, TOKEN_NAME_MAX } from "@/db/schema";
import type { TokenSummary } from "@/lib/api-tokens";
import { cn } from "@/lib/utils";

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

export function ApiTokensCard({
  tokens,
  intro,
  usage,
}: {
  tokens: TokenSummary[];
  intro?: React.ReactNode;
  /** What to do with a token once it is copied. */
  usage: React.ReactNode;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const atLimit =
    tokens.filter((t) => t.status === "active" && t.source === "manual").length >=
    MAX_TOKENS_PER_USER;

  async function call(key: string, path: string, init: RequestInit) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (body as { message?: string })?.message ?? `Request failed (${res.status})`,
        );
      }
      return body as unknown;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (name.trim().length === 0) return;
    const body = (await call("mint", "/api/tokens", {
      method: "POST",
      body: JSON.stringify({ name: name.trim() }),
    })) as { token?: { token: string } } | null;

    if (body?.token) {
      setMinted(body.token.token);
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

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setError("Could not copy — select the token and copy it manually.");
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        {intro}

        {error && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}

        {minted && (
          <div className="space-y-2 rounded-md border border-brand/40 bg-brand/5 p-3">
            <p className="text-sm font-medium">
              Copy this now — it will not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-xs">
                {minted}
              </code>
              <Button variant="outline" size="sm" onClick={() => copy(minted)}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">{usage}</div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            maxLength={TOKEN_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="What is it for? e.g. laptop"
            className="max-w-64"
            disabled={atLimit}
          />
          <Button
            onClick={create}
            disabled={busy === "mint" || name.trim().length === 0 || atLimit}
          >
            {busy === "mint" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Create
          </Button>
          {atLimit && (
            <span className="text-sm text-muted-foreground">
              {MAX_TOKENS_PER_USER} active tokens is the limit — revoke one first.
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
                  {t.lastUsedAt ? `last used ${shortDate(t.lastUsedAt)}` : "never used"}
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
  );
}
