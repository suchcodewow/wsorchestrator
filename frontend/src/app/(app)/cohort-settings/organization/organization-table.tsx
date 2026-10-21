"use client";

/** One page of everyone under the Organization Leader, as of the last HiBob sync. */

import { Fragment, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { HEADER_ROW, LINK_ROW, Pager, SortHeader, TableSearch } from "@/components/data-table";
import type { OrganizationDetail, OrganizationMember } from "@/lib/evals/roster";
import type { OrganizationSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { formatDate, formatWhen } from "../format";

const COLUMNS: { column: OrganizationSort; label: string }[] = [
  { column: "fullName", label: "Name" },
  { column: "email", label: "Email" },
  { column: "reportsToName", label: "Manager" },
];

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="wrap-break-word">{value || "—"}</dd>
    </div>
  );
}

function Details({ detail }: { detail: OrganizationDetail | undefined }) {
  if (!detail) return <p className="text-muted-foreground">No details stored for this person.</p>;
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">HiBob</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
          <Field label="Title" value={detail.title} />
          <Field label="Department" value={detail.department} />
          <Field label="Site" value={detail.site} />
          <Field label="Manager" value={detail.reportsToName || detail.reportsToEmail} />
          <Field label="Manager email" value={detail.reportsToEmail} />
          <Field label="Started" value={detail.startDate ? formatDate(detail.startDate) : null} />
          <Field label="In role since" value={detail.activeEffectiveDate ? formatDate(detail.activeEffectiveDate) : null} />
          <Field label="Last synced" value={formatWhen(detail.importedAt)} />
          {detail.hibob.map((f) => (
            <Field key={f.label} label={f.label} value={f.value} />
          ))}
        </dl>
      </section>
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Slack</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
          <Field label="Slack user id" value={detail.slackUserId} />
          <Field label="Time zone" value={detail.timezone} />
          <Field label="Last looked up" value={detail.slackLookedUpAt ? formatWhen(detail.slackLookedUpAt) : null} />
        </dl>
      </section>
    </div>
  );
}

export function OrganizationTable({
  query,
  page,
  details,
  count,
  leaderEmail,
  leaderName,
  current,
}: {
  query: ListQuery<OrganizationSort>;
  page: Page<OrganizationMember>;
  details: Record<string, OrganizationDetail>;
  /** Everyone the sync found, whatever the search. */
  count: number;
  leaderEmail: string | null;
  leaderName: string | null;
  current: boolean;
}) {
  const shown = page.rows;
  const [open, setOpen] = useState<string | null>(null);

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Organization</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {leaderEmail ? (
            <>
              <span className="font-medium text-foreground">{count.toLocaleString()} people</span> report
              up to {leaderName ?? leaderEmail}, as of the last HiBob sync.
            </>
          ) : (
            <>
              No Organization Leader has been synced yet — set one on the{" "}
              <Link href="/cohort-settings/automation" className="underline underline-offset-4">
                Automation
              </Link>{" "}
              tab, then run a sync from the{" "}
              <Link href="/cohort-settings/hibob" className="underline underline-offset-4">
                HiBob
              </Link>{" "}
              tab.
            </>
          )}
        </p>
        {leaderEmail && !current && (
          <p className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
            <TriangleAlert className="size-3.5" />
            The Organization Leader has changed since this sync — run a new sync to update this list.
          </p>
        )}
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch
          value={query.q}
          placeholder="Search by name, email, title, department or manager"
          label="Search the organization"
        />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                {COLUMNS.map((c) => (
                  <SortHeader key={c.column} column={c.column} sort={query.sort} dir={query.dir}>
                    {c.label}
                  </SortHeader>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const expanded = open === m.email;
                return (
                  <Fragment key={m.email}>
                    <tr
                      className={LINK_ROW}
                      aria-expanded={expanded}
                      onClick={() => {
                        if (!window.getSelection()?.toString()) setOpen(expanded ? null : m.email);
                      }}
                    >
                      <td className="px-5 py-2.5 font-medium">
                        <span className="inline-flex items-center gap-1">
                          <ChevronRight
                            className={`size-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
                          />
                          {m.fullName}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-muted-foreground">{m.email}</td>
                      <td className="px-5 py-2.5 text-muted-foreground">{m.reportsToName || m.reportsToEmail || "—"}</td>
                    </tr>
                    {expanded && (
                      <tr className="border-b bg-muted/20 text-sm">
                        <td colSpan={COLUMNS.length} className="px-5 py-4">
                          <Details detail={details[m.email]} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-5 py-8 text-center text-muted-foreground">
                    {count ? "No one matches." : "No one reports up to the leader yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="people" />
        </div>
      </motion.div>
    </motion.div>
  );
}
