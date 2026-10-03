"use client";

/**
 * The Additional Slack Contacts: a field to find an employee by name, or type
 * any email, and add them; then a page of those added, searched and sorted by
 * the database.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Trash2 } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { EmployeePicker } from "@/components/employee-picker";
import { Button } from "@/components/ui/button";
import type { SlackContactSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { formatWhen } from "../../cohort-settings/format";

export type SlackContactListing = {
  id: string;
  email: string;
  fullName: string;
  createdAt: string;
  addedBy: string | null;
};

const COLUMNS: { column: SlackContactSort; label: string }[] = [
  { column: "fullName", label: "Name" },
  { column: "email", label: "Email" },
  { column: "addedBy", label: "Added by" },
  { column: "createdAt", label: "Added" },
];

const ERRORS: Record<string, string> = {
  invalid: "Pick someone from the list, or type a full email address.",
  duplicate: "That person is already an Additional Slack Contact.",
  not_found: "That contact was already removed — reload the page.",
  forbidden: "Your own role changed — reload the page.",
};

export function SlackContactsView({
  query,
  page,
  count,
}: {
  query: ListQuery<SlackContactSort>;
  page: Page<SlackContactListing>;
  count: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sortProps = { sort: query.sort, dir: query.dir };

  async function send(key: string, url: string, init: RequestInit) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(ERRORS[body?.error ?? ""] ?? `Could not save (${res.status}).`);
        return null;
      }
      router.refresh();
      return body ?? {};
    } catch {
      setError("Could not reach the server.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Additional Slack Contacts</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">
            {count.toLocaleString()} {count === 1 ? "contact" : "contacts"}
          </span>{" "}
          added to every team&apos;s Slack message at the end of a bootcamp.
        </p>
      </motion.div>

      <motion.div variants={riseChild}>
        <EmployeePicker
          id="slack-contact"
          label="Add a contact"
          placeholder="Search employees by name, or type an email"
          allowAnyEmail
          busy={busy === "add"}
          onAdd={async (email) => {
            const body = await send("add", "/api/evals/slack-contacts", {
              method: "POST",
              body: JSON.stringify({ email }),
            });
            if (!body) return false;
            setNotice(`Added ${body.fullName || body.email}.`);
            return true;
          }}
        />
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}
      {notice && (
        <motion.p variants={riseChild} role="status" className="text-sm text-muted-foreground">
          {notice}
        </motion.p>
      )}

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by name, email or who added them" label="Search contacts" />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                {COLUMNS.map(({ column, label }) => (
                  <SortHeader key={column} column={column} {...sortProps}>
                    {label}
                  </SortHeader>
                ))}
                <PlainHeader className="w-16" />
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No contacts match that search." : "No contacts yet."}
                  </td>
                </tr>
              )}
              {page.rows.map((c) => (
                <tr key={c.id} className="border-b transition-colors last:border-b-0 hover:bg-muted/30">
                  <td className="px-5 py-3 font-medium">{c.fullName || "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{c.email}</td>
                  <td className="px-5 py-3 text-muted-foreground">{c.addedBy ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatWhen(c.createdAt)}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${c.fullName || c.email}`}
                        disabled={busy === c.id}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={async () => {
                          const body = await send(c.id, `/api/evals/slack-contacts/${c.id}`, { method: "DELETE" });
                          if (body) setNotice(`Removed ${c.fullName || c.email}.`);
                        }}
                      >
                        {busy === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="contacts" />
        </div>
      </motion.div>
    </motion.div>
  );
}
