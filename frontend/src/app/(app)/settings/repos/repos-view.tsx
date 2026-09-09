"use client";

/** The GitHub repositories every workshop imports into Harness Code. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Check,
  ExternalLink,
  FolderKanban,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { REPO_LIMITS, type RepoScope } from "@/db/schema";
import {
  parseGithubUrl,
  repoIdentifierValid,
  suggestedIdentifier,
  type RepoRow,
} from "@/lib/github-repos";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

const ERRORS: Record<string, string> = {
  invalid_url:
    "Use the repository's own GitHub address, like https://github.com/owner/name.",
  invalid_identifier:
    "A Harness repository name holds letters, digits, dots, hyphens and underscores, starting with a letter or digit.",
  invalid_scope: "Choose org or project.",
  duplicate: "A repository with that name is already imported at that level.",
  not_found: "That entry was already removed — reload the page.",
  forbidden: "Your own role changed — reload the page.",
};

const message = (error: string | undefined, status: number) =>
  ERRORS[error ?? ""] ?? `Could not save (${status})`;

const SCOPES: { value: RepoScope; label: string; Icon: typeof Layers }[] = [
  { value: "org", label: "Org", Icon: Layers },
  { value: "project", label: "Project", Icon: FolderKanban },
];

export function ReposView({ repos }: { repos: RepoRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function send(
    key: string,
    url: string,
    init: RequestInit,
  ): Promise<boolean> {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(message(body?.error, res.status));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
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
        <h2 className="text-xl font-medium tracking-tight">GitHub Repos</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Every repository here is imported into Harness Code when a workshop is
          created — once into the event&rsquo;s organization, or once into each
          attendee&rsquo;s own project, whichever this list says.
        </p>
      </motion.div>

      {error && (
        <motion.p
          variants={riseChild}
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </motion.p>
      )}

      <motion.div
        variants={riseChild}
        className="overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Repository</th>
                <th className="px-5 py-2.5 font-medium">Name in Harness</th>
                <th className="px-5 py-2.5 font-medium">Imported into</th>
                <th className="px-5 py-2.5 font-medium">Added by</th>
                <th className="w-24 px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {repos.length === 0 && !adding && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-8 text-center text-muted-foreground"
                  >
                    No repositories yet.
                  </td>
                </tr>
              )}

              {repos.map((row) =>
                editing === row.id ? (
                  <EditRow
                    key={row.id}
                    row={row}
                    busy={busy === row.id}
                    onCancel={() => setEditing(null)}
                    onSave={async (values) => {
                      const ok = await send(
                        row.id,
                        `/api/settings/repos/${row.id}`,
                        { method: "PATCH", body: JSON.stringify(values) },
                      );
                      if (ok) setEditing(null);
                    }}
                  />
                ) : (
                  <tr
                    key={row.id}
                    className="border-b transition-colors last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-5 py-3">
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 font-mono hover:text-brand hover:underline"
                      >
                        {row.providerRepo}
                        <ExternalLink className="size-3" />
                      </a>
                    </td>
                    <td className="px-5 py-3 font-mono font-medium">
                      {row.identifier}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {row.scope === "org" ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Layers className="size-3.5" />
                          the workshop&rsquo;s org
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <FolderKanban className="size-3.5" />
                          every attendee&rsquo;s project
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {row.addedBy ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${row.identifier}`}
                          disabled={busy === row.id}
                          onClick={() => {
                            setError(null);
                            setEditing(row.id);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${row.identifier}`}
                          disabled={busy === row.id}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() =>
                            send(row.id, `/api/settings/repos/${row.id}`, {
                              method: "DELETE",
                            })
                          }
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
                ),
              )}

              {adding ? (
                <EditRow
                  busy={busy === "new"}
                  onCancel={() => setAdding(false)}
                  onSave={async (values) => {
                    const ok = await send("new", "/api/settings/repos", {
                      method: "POST",
                      body: JSON.stringify(values),
                    });
                    if (ok) setAdding(false);
                  }}
                />
              ) : (
                <tr>
                  <td colSpan={5} className="px-5 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={() => {
                        setError(null);
                        setAdding(true);
                      }}
                    >
                      <Plus className="size-3.5" />
                      Add repository
                    </Button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      <motion.div variants={riseChild}>
        <Card>
          <CardContent className="grid gap-2 py-5 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">
                Only public repositories.
              </span>{" "}
              The import runs with no GitHub credential, so a private repository
              comes back as <span className="font-mono text-xs">Not Found</span>{" "}
              in the run log.
            </p>
            <p>
              <span className="font-medium text-foreground">
                A failed import does not fail the workshop.
              </span>{" "}
              Each repository is imported on its own and any that will not come
              across is reported in the run log by name.
            </p>
            <p>
              <span className="font-medium text-foreground">
                Nothing to tear down.
              </span>{" "}
              An imported repository is a copy inside the event&rsquo;s
              organization, and goes when the organization does.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

function EditRow({
  row,
  busy,
  onSave,
  onCancel,
}: {
  row?: RepoRow;
  busy: boolean;
  onSave: (values: {
    url: string;
    identifier: string;
    scope: RepoScope;
  }) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(row?.url ?? "");
  const [identifier, setIdentifier] = useState(row?.identifier ?? "");
  const [scope, setScope] = useState<RepoScope>(row?.scope ?? "org");
  /** True once the name has been typed in, so the URL stops pre-filling it. */
  const [named, setNamed] = useState(row !== undefined);

  const github = parseGithubUrl(url);
  const valid = github !== null && repoIdentifierValid(identifier);

  function submit() {
    if (!valid || busy) return;
    onSave({ url, identifier, scope });
  }

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") onCancel();
  };

  return (
    <tr className="border-b bg-muted/20 last:border-b-0">
      <td className="px-5 py-2.5">
        <Input
          autoFocus
          value={url}
          maxLength={REPO_LIMITS.url}
          placeholder="https://github.com/owner/name"
          aria-label="GitHub repository URL"
          spellCheck={false}
          className="font-mono"
          onChange={(e) => {
            setUrl(e.target.value);
            // The GitHub name is almost always the right answer, so it is
            // offered as the URL is typed — and left alone the moment the
            // administrator has an answer of their own.
            if (!named) {
              const parsed = parseGithubUrl(e.target.value);
              setIdentifier(parsed ? suggestedIdentifier(parsed.providerRepo) : "");
            }
          }}
          onKeyDown={keys}
        />
      </td>
      <td className="px-5 py-2.5">
        <Input
          value={identifier}
          maxLength={REPO_LIMITS.identifier}
          placeholder="name-in-harness"
          aria-label="Name in Harness"
          spellCheck={false}
          className="font-mono"
          onChange={(e) => {
            setNamed(true);
            setIdentifier(e.target.value);
          }}
          onKeyDown={keys}
        />
      </td>
      <td className="px-5 py-2.5" colSpan={2}>
        <div
          role="radiogroup"
          aria-label="Where it is imported"
          className="flex w-fit overflow-hidden rounded-md border"
        >
          {SCOPES.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={scope === value}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors",
                scope === value
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
              onClick={() => setScope(value)}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </td>
      <td className="px-5 py-2.5">
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Save"
            disabled={!valid || busy}
            onClick={submit}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Cancel"
            disabled={busy}
            onClick={onCancel}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
