"use client";

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
    "That isn't a Harness identifier. Letters, digits, underscores and hyphens, starting with a letter or underscore.",
  duplicate: "A secret with that id is already on the list.",
  empty: "There's no value to store.",
  too_large: `Values must be under ${ORG_SECRET_LIMITS.bytes / 1024} KB.`,
  binary:
    "That file isn't text. A Harness secret file holds text — a key, a PEM, a config — so an archive or a binary can't be stored as one.",
  malformed: "That form was incomplete. Reload the page and try again.",
  not_found: "That secret was already removed. Reload the page.",
  forbidden: "Your own role changed. Reload the page.",
  no_key:
    "This deployment has no encryption key, so a value can't be stored. An administrator needs to set AUTH_SECRET or HARNESS_TOKEN_ENC_KEY.",
};

const message = (error: string | undefined, status: number) =>
  ERRORS[error ?? ""] ?? `Could not save (${status})`;

/** Value sizes here run from a dozen bytes to a few kilobytes. */
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
}: {
  secrets: OrgSecretRow[];
  /** Whether an encryption key exists. Without one nothing can be saved. */
  configured: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  /** One place for the fetch, the error shape, and the refresh after it. */
  async function send(
    key: string,
    url: string,
    init: RequestInit,
  ): Promise<boolean> {
    setBusy(key);
    setError(null);
    setSaved(null);
    try {
      // No Content-Type header: every write here is a `FormData` body, and
      // fetch has to set the multipart boundary itself.
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
        <h2 className="text-xl font-medium tracking-tight">Org secrets</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Every secret here is created in the Harness organization of every
          workshop, as the org secret it is named after — before the component
          catalog is applied, so a connector can reference one as{" "}
          <span className="font-mono text-xs">org.&lt;id&gt;</span>. Values are
          stored encrypted and never shown again; changing one changes what the
          <em> next</em> workshop is built with, and leaves the copies in
          workshops already running alone.
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

      {/* New secret. A card of its own rather than a row in the table below:
          the form is three controls and one of them is a file input, which no
          table cell has room for. */}
      <motion.div variants={riseChild}>
        {adding ? (
          <Card>
            <CardContent className="py-5">
              <SecretForm
                busy={busy === "new"}
                disabled={!configured}
                onCancel={() => setAdding(false)}
                onSave={async (form) => {
                  const ok = await send("new", "/api/settings/org-secrets", {
                    method: "POST",
                    body: form,
                  });
                  if (ok) {
                    setAdding(false);
                    setSaved(
                      `Saved. ${String(form.get("identifier"))} will be created in every new workshop's org.`,
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
        {/* Scrolls inside the card rather than being clipped by it — the same
            wrapper the users and domains tables use. */}
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
                    No org secrets. Workshops are built with the component
                    catalog alone.
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
                          const ok = await send(
                            row.id,
                            `/api/settings/org-secrets/${row.id}`,
                            { method: "PATCH", body: form },
                          );
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
                          title="The deployment's encryption key changed. Store the value again."
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
                            send(row.id, `/api/settings/org-secrets/${row.id}`, {
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

/** Mirrors the server's rule, so a typo is caught before a round trip. */
const identifierValid = (value: string) =>
  /^[a-zA-Z_][0-9a-zA-Z_$-]{0,127}$/.test(value.trim());

/**
 * The add and edit form are the same form — one used empty, one used with a
 * row's id and kind filled in.
 *
 * Editing still requires a value, and that is not an oversight: the stored one
 * cannot be read back to leave alone, so there is nothing to prefill and no way
 * to save "the same value under a new name". The form says so.
 */
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

        {/* Two buttons rather than a select: there are exactly two kinds, and
            which one is chosen decides which control appears beside them. */}
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
            // A password field: this is a live credential, and it is pasted far
            // more often than typed.
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
          ? "The stored value can't be read back, so an edit has to include the value again — even if only the id is changing."
          : "A file is stored as a Harness secret file and has to be text: a service account key, a PEM, a config. Everything else is stored as inline text."}
      </p>
    </div>
  );
}
