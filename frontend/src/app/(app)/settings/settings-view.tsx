"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Loader2, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ALLOWED_DOMAIN_LIMITS } from "@/db/schema";
import { normalizeDomain } from "@/lib/email-domains";
import { riseChild, staggerParent } from "@/lib/motion";

export type DomainRow = {
  id: string;
  domain: string;
  note: string;
  /** ISO — the server component can't hand a `Date` across the boundary. */
  createdAt: string;
  addedBy: string | null;
};

const ERRORS: Record<string, string> = {
  invalid: "That isn't a domain. Use the part after the @, like example.com.",
  duplicate: "That domain is already on the list.",
  not_found: "That entry was already removed. Reload the page.",
  self_lockout:
    "That change would leave your own address unable to sign in. Add a domain that covers you first, or have another administrator make the change.",
  forbidden: "Your own role changed. Reload the page.",
};

function message(error: string | undefined, status: number) {
  return ERRORS[error ?? ""] ?? `Could not save (${status})`;
}

export function SettingsView({
  domains,
  envDomains,
  viewerEmail,
  viewerExempt,
}: {
  domains: DomainRow[];
  /** From `AUTH_ALLOWED_EMAIL_DOMAINS`. In force, but not editable here. */
  envDomains: string[];
  viewerEmail: string;
  /** In `SITE_ADMIN_EMAILS`, so allowed in regardless of the list below. */
  viewerExempt: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const restricted = domains.length + envDomains.length > 0;

  /** One place for the fetch, the error shape, and the refresh after it. */
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
      className="space-y-8"
    >
      <motion.div variants={riseChild} className="space-y-1.5">
        <h1 className="text-3xl font-medium tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Site-wide configuration. Only administrators see this page.
        </p>
      </motion.div>

      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Sign-in domains</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {restricted ? (
            <>
              Only these email domains can sign in. Everyone else is turned away
              at Google, before any account is created.
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">
                Anyone with a Google account can sign in
              </span>{" "}
              — and arrive as an operator, able to schedule events that build
              real cloud accounts. Add a domain to limit that.
            </>
          )}{" "}
          Attendees are unaffected: they open a link and never sign in.
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
        {/* Scrolls inside the card rather than being clipped by it — see the
            same wrapper on the users table. Four columns need more floor than
            three, and the note column is free text. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Domain</th>
                <th className="px-5 py-2.5 font-medium">Note</th>
                <th className="px-5 py-2.5 font-medium">Added by</th>
                <th className="w-24 px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {envDomains.map((domain) => (
                <EnvRow key={domain} domain={domain} />
              ))}

              {domains.map((row) =>
                editing === row.id ? (
                  <EditRow
                    key={row.id}
                    row={row}
                    busy={busy === row.id}
                    onCancel={() => setEditing(null)}
                    onSave={async (values) => {
                      const ok = await send(row.id, `/api/settings/domains/${row.id}`, {
                        method: "PATCH",
                        body: JSON.stringify(values),
                      });
                      if (ok) setEditing(null);
                    }}
                  />
                ) : (
                  <tr
                    key={row.id}
                    className="border-b transition-colors last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-5 py-3 font-mono font-medium">
                      {row.domain}
                      {viewerEmail.endsWith(`@${row.domain}`) && (
                        <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">
                          yours
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {row.note || "—"}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {row.addedBy ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${row.domain}`}
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
                          aria-label={`Remove ${row.domain}`}
                          disabled={busy === row.id}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() =>
                            send(row.id, `/api/settings/domains/${row.id}`, {
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
                    const ok = await send("new", "/api/settings/domains", {
                      method: "POST",
                      body: JSON.stringify(values),
                    });
                    if (ok) setAdding(false);
                  }}
                />
              ) : (
                <tr>
                  <td colSpan={4} className="px-5 py-3">
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
                      Add domain
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
                You can&apos;t lock yourself out.
              </span>{" "}
              {viewerExempt ? (
                <>
                  Your address is in <code>SITE_ADMIN_EMAILS</code>, so you can
                  sign in whatever this list says.
                </>
              ) : (
                <>
                  A change that would leave{" "}
                  <span className="font-mono">{viewerEmail}</span> unable to sign
                  in is refused. Addresses in <code>SITE_ADMIN_EMAILS</code> are
                  always allowed, whatever their domain.
                </>
              )}
            </p>
            <p>
              <span className="font-medium text-foreground">
                Existing sessions keep working.
              </span>{" "}
              The check runs at sign-in, so removing a domain stops the next
              sign-in rather than ending sessions already open. To cut someone
              off now, delete their account on the users page.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

/** A domain from the environment: in force, but nothing here can change it. */
function EnvRow({ domain }: { domain: string }) {
  return (
    <tr className="border-b bg-muted/20 last:border-b-0">
      <td className="px-5 py-3 font-mono font-medium">{domain}</td>
      <td className="px-5 py-3 text-muted-foreground" colSpan={2}>
        Set by <code>AUTH_ALLOWED_EMAIL_DOMAINS</code> — always in force
      </td>
      <td className="px-5 py-3">
        <div
          className="flex justify-end pr-2 text-muted-foreground"
          title="Change this in the deployment's configuration"
        >
          <Lock className="size-3.5" />
        </div>
      </td>
    </tr>
  );
}

/**
 * The add and edit row are the same row — one form, used once with a value and
 * once empty. Splitting them would have meant two copies of the validation and
 * the keyboard handling.
 */
function EditRow({
  row,
  busy,
  onSave,
  onCancel,
}: {
  row?: DomainRow;
  busy: boolean;
  onSave: (values: { domain: string; note: string }) => void;
  onCancel: () => void;
}) {
  const [domain, setDomain] = useState(row?.domain ?? "");
  const [note, setNote] = useState(row?.note ?? "");

  // Mirrors the server's rule so a typo is caught before a round trip. The
  // server normalizes and validates again — this only decides when to grey the
  // button out.
  const valid = normalizeDomain(domain) !== null;

  function submit() {
    if (!valid || busy) return;
    onSave({ domain, note });
  }

  return (
    <tr className="border-b bg-muted/20 last:border-b-0">
      <td className="px-5 py-2.5">
        <Input
          autoFocus
          value={domain}
          maxLength={ALLOWED_DOMAIN_LIMITS.domain}
          placeholder="example.com"
          aria-label="Domain"
          spellCheck={false}
          className="font-mono"
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
        />
      </td>
      <td className="px-5 py-2.5" colSpan={2}>
        <Input
          value={note}
          maxLength={ALLOWED_DOMAIN_LIMITS.note}
          placeholder="Why it's allowed (optional)"
          aria-label="Note"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
        />
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
