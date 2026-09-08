"use client";

/**
 * The secrets a workshop's Harness organization is given, either the site's own
 * or one account's, which is all the two differ by.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ORG_SECRET_LIMITS, type OrgSecretKind } from "@/db/schema";
import type { OrgSecretRow } from "@/lib/harness-org-secrets";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

const ERRORS: Record<string, string> = {
  invalid_identifier:
    "A Harness identifier holds letters, digits, underscores and hyphens, starting with a letter or underscore.",
  duplicate: "A secret with that id is already on the list.",
  empty: "There's no value to store.",
  too_large: `Values must be under ${ORG_SECRET_LIMITS.bytes / 1024} KB.`,
  binary:
    "A Harness secret file holds text, so an archive or a binary can't be stored as one.",
  malformed: "That form was incomplete — reload the page and try again.",
  not_found: "That secret was already removed — reload the page.",
  forbidden: "Your own role changed — reload the page.",
  no_key:
    "This deployment has no encryption key, so a value can't be stored.",
};

const message = (error: string | undefined, status: number) =>
  ERRORS[error ?? ""] ?? `Could not save (${status})`;

const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

export function OrgSecretsView({
  secrets,
  configured,
  mine = false,
}: {
  secrets: OrgSecretRow[];
  configured: boolean;
  /** True on My settings, where the secrets are one account's own. */
  mine?: boolean;
}) {
  const api = mine ? "/api/me/org-secrets" : "/api/settings/org-secrets";
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
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
    setSaved(null);
    try {
      const res = await fetch(url, init);
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
        <h2 className="text-xl font-medium tracking-tight">
          {mine ? "My org secrets" : "Org secrets"}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {mine ? (
            <>
              Every secret here is created in each Harness organization{" "}
              <em>you</em>{" "}
              deploy, alongside the site&rsquo;s own org secrets. One of yours
              named the same as a site secret is the one that gets written. A
              connector can reference either as{" "}
              <span className="font-mono text-xs">org.&lt;id&gt;</span>.
            </>
          ) : (
            <>
              Every secret here is created in each new workshop&rsquo;s Harness
              organization, where a connector can reference it as{" "}
              <span className="font-mono text-xs">org.&lt;id&gt;</span>.
            </>
          )}
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
            This deployment has no encryption key, so a value cannot be stored
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
        {adding ? (
          <Card>
            <CardContent className="py-5">
              <SecretForm
                busy={busy === "new"}
                disabled={!configured}
                onCancel={() => setAdding(false)}
                onSave={async (form) => {
                  const ok = await send("new", api, {
                    method: "POST",
                    body: form,
                  });
                  if (ok) {
                    setAdding(false);
                    setSaved(
                      `Saved. ${String(form.get("identifier"))} will be created in ${
                        mine
                          ? "every org you deploy"
                          : "every new workshop's org"
                      }.`,
                    );
                  }
                }}
              />
            </CardContent>
          </Card>
        ) : (
          <Button
            variant="outline"
            disabled={!configured}
            onClick={() => {
              setError(null);
              setSaved(null);
              setAdding(true);
            }}
          >
            <Plus className="size-3.5" />
            Add secret
          </Button>
        )}
      </motion.div>

      <motion.div
        variants={riseChild}
        className="overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Id</th>
                <th className="px-5 py-2.5 font-medium">Value</th>
                <th className="px-5 py-2.5 font-medium">Updated</th>
                <th className="px-5 py-2.5 font-medium">By</th>
                <th className="w-24 px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {secrets.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-8 text-center text-muted-foreground"
                  >
                    {mine ? "No org secrets of your own yet." : "No org secrets yet."}
                  </td>
                </tr>
              )}

              {secrets.map((row) =>
                editing === row.id ? (
                  <tr key={row.id} className="border-b bg-muted/20 last:border-b-0">
                    <td colSpan={5} className="px-5 py-4">
                      <SecretForm
                        row={row}
                        busy={busy === row.id}
                        disabled={!configured}
                        onCancel={() => setEditing(null)}
                        onSave={async (form) => {
                          const ok = await send(row.id, `${api}/${row.id}`, {
                            method: "PATCH",
                            body: form,
                          });
                          if (ok) {
                            setEditing(null);
                            setSaved(`New value stored for ${String(form.get("identifier"))}.`);
                          }
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={row.id}
                    className="border-b transition-colors last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-5 py-3 font-mono font-medium">
                      {row.identifier}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        {row.kind === "file" ? (
                          <FileText className="size-3.5" />
                        ) : (
                          <Type className="size-3.5" />
                        )}
                        {row.kind === "file"
                          ? (row.fileName ?? "file")
                          : "inline text"}
                        <span className="text-xs">({size(row.bytes)})</span>
                      </span>
                      {!row.usable && (
                        <span
                          className="ml-2 text-xs text-destructive"
                          title="The encryption key changed, so store the value again."
                        >
                          unreadable
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {shortDate(row.updatedAt)}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {row.updatedBy ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Replace the value of ${row.identifier}`}
                          disabled={busy === row.id || !configured}
                          onClick={() => {
                            setError(null);
                            setSaved(null);
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
                            send(row.id, `${api}/${row.id}`, {
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
            </tbody>
          </table>
        </div>
      </motion.div>
    </motion.div>
  );
}

const identifierValid = (value: string) =>
  /^[a-zA-Z_][0-9a-zA-Z_$-]{0,127}$/.test(value.trim());

function SecretForm({
  row,
  busy,
  disabled,
  onSave,
  onCancel,
}: {
  row?: OrgSecretRow;
  busy: boolean;
  disabled: boolean;
  onSave: (form: FormData) => void;
  onCancel: () => void;
}) {
  const [identifier, setIdentifier] = useState(row?.identifier ?? "");
  const [kind, setKind] = useState<OrgSecretKind>(row?.kind ?? "text");
  const [value, setValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const ready =
    identifierValid(identifier) &&
    (kind === "text" ? value.length > 0 : file !== null);

  function submit() {
    if (!ready || busy || disabled) return;
    const form = new FormData();
    form.set("identifier", identifier.trim());
    form.set("kind", kind);
    if (kind === "text") form.set("value", value);
    else form.set("file", file!);
    onSave(form);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          autoFocus
          value={identifier}
          maxLength={ORG_SECRET_LIMITS.identifier}
          placeholder="secret_id"
          aria-label="Secret id"
          spellCheck={false}
          className="w-56 font-mono"
          onChange={(e) => setIdentifier(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
        />

        <div className="flex overflow-hidden rounded-md border">
          {(["text", "file"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors",
                kind === option
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
              onClick={() => setKind(option)}
            >
              {option === "text" ? (
                <Type className="size-3.5" />
              ) : (
                <FileText className="size-3.5" />
              )}
              {option === "text" ? "Text" : "File"}
            </button>
          ))}
        </div>

        {kind === "text" ? (
          <Input
            type="password"
            value={value}
            autoComplete="off"
            spellCheck={false}
            placeholder={row ? "New value" : "Value"}
            aria-label="Value"
            className="min-w-64 flex-1"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") onCancel();
            }}
          />
        ) : (
          <div className="flex min-w-64 flex-1 items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              aria-label="File"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInput.current?.click()}
            >
              Choose file
            </Button>
            <span className="truncate text-sm text-muted-foreground">
              {file ? `${file.name} (${size(file.size)})` : "No file chosen"}
            </span>
          </div>
        )}

        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Save"
            disabled={!ready || busy || disabled}
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
      </div>

      <p className="text-xs text-muted-foreground">
        {row
          ? "An edit has to include the value again, because the stored one can't be read back."
          : "A file has to be text, such as a service account key, a PEM, or a config."}
      </p>
    </div>
  );
}
