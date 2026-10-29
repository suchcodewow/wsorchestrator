"use client";

/**
 * The Allowed Domains tab: the email domains allowed to sign in, then the
 * sites allowed to show the app in a frame. Each is the deployment's own, if
 * any, then a page of those added here, searched and sorted by the database;
 * the one search box serves both.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Loader2, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ALLOWED_DOMAIN_LIMITS } from "@/db/schema";
import { normalizeDomain } from "@/lib/email-domains";
import { normalizeFrameDomain } from "@/lib/frame-ancestors";
import { FRAME_DOMAIN_PREFIX, type DomainSort, type FrameDomainSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";

export type DomainRow = {
  id: string;
  domain: string;
  note: string;
  createdAt: string;
  addedBy: string | null;
};

const ERRORS: Record<string, string> = {
  invalid: "Use just the part after the @, like example.com.",
  duplicate: "That domain is already on the list.",
  not_found: "That entry was already removed — reload the page.",
  self_lockout:
    "That change would leave your own address unable to sign in.",
  forbidden: "Your own role changed — reload the page.",
};

function message(error: string | undefined, status: number) {
  return ERRORS[error ?? ""] ?? `Could not save (${status})`;
}

export function DomainsView({
  query,
  page,
  envDomains,
  viewerEmail,
  frameQuery,
  framePage,
}: {
  query: ListQuery<DomainSort>;
  page: Page<DomainRow>;
  envDomains: string[];
  viewerEmail: string;
  frameQuery: ListQuery<FrameDomainSort>;
  framePage: Page<DomainRow>;
}) {
  return (
    <motion.div
      variants={staggerParent(0.05)}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by domain, note or who added it" label="Search domains" />
      </motion.div>

      <motion.div variants={riseChild} className="space-y-4">
        <h2 className="text-xl font-medium tracking-tight">Sign-in domains</h2>
        <DomainTable
          query={query}
          page={page}
          api="/api/settings/domains"
          normalize={normalizeDomain}
          notePlaceholder="Why it's allowed (optional)"
          envDomains={envDomains}
          viewerEmail={viewerEmail}
        />
      </motion.div>

      <motion.div variants={riseChild} className="space-y-4">
        <h2 className="text-xl font-medium tracking-tight">Allowed iFrame Domains</h2>
        <DomainTable
          query={frameQuery}
          page={framePage}
          prefix={FRAME_DOMAIN_PREFIX}
          api="/api/settings/frame-domains"
          normalize={normalizeFrameDomain}
          notePlaceholder="The site that frames the app (optional)"
          placeholder="mindtickle.com"
        />
      </motion.div>
    </motion.div>
  );
}

/** One editable list of domains: the deployment's own on top, then a page of those added here. */
function DomainTable({
  query,
  page,
  prefix,
  api,
  normalize,
  notePlaceholder,
  placeholder = "example.com",
  envDomains: allEnvDomains = [],
  viewerEmail,
}: {
  query: ListQuery<DomainSort | FrameDomainSort>;
  page: Page<DomainRow>;
  prefix?: string;
  api: string;
  normalize: (value: string) => string | null;
  notePlaceholder: string;
  placeholder?: string;
  envDomains?: string[];
  /** Marks the viewer's own domain, on the list that decides who signs in. */
  viewerEmail?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const domains = page.rows;
  const sortProps = { sort: query.sort, dir: query.dir, prefix };
  // The deployment's own come from its configuration, not the database: a
  // handful, shown above the first page.
  const q = query.q.toLowerCase();
  const envDomains = page.page === 1 ? allEnvDomains.filter((d) => d.includes(q)) : [];

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
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="domain" {...sortProps}>
                  Domain
                </SortHeader>
                <SortHeader column="note" {...sortProps}>
                  Note
                </SortHeader>
                <SortHeader column="addedBy" {...sortProps}>
                  Added by
                </SortHeader>
                <PlainHeader className="w-24" />
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
                    normalize={normalize}
                    placeholder={placeholder}
                    notePlaceholder={notePlaceholder}
                    onCancel={() => setEditing(null)}
                    onSave={async (values) => {
                      const ok = await send(row.id, `${api}/${row.id}`, {
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
                      {viewerEmail?.endsWith(`@${row.domain}`) && (
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

              {adding ? (
                <EditRow
                  busy={busy === "new"}
                  normalize={normalize}
                  placeholder={placeholder}
                  notePlaceholder={notePlaceholder}
                  onCancel={() => setAdding(false)}
                  onSave={async (values) => {
                    const ok = await send("new", api, {
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
        <div className="border-t empty:hidden">
          <Pager page={page} noun="domains" prefix={prefix} />
        </div>
      </div>
    </>
  );
}

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

function EditRow({
  row,
  busy,
  normalize,
  placeholder,
  notePlaceholder,
  onSave,
  onCancel,
}: {
  row?: DomainRow;
  busy: boolean;
  normalize: (value: string) => string | null;
  placeholder: string;
  notePlaceholder: string;
  onSave: (values: { domain: string; note: string }) => void;
  onCancel: () => void;
}) {
  const [domain, setDomain] = useState(row?.domain ?? "");
  const [note, setNote] = useState(row?.note ?? "");

  const valid = normalize(domain) !== null;

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
          placeholder={placeholder}
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
          placeholder={notePlaceholder}
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
