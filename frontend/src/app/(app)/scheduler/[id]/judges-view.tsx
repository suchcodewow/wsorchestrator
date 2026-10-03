"use client";

/**
 * One bootcamp's guest judges. A Training administrator adds them from the
 * employee list and removes them; while the bootcamp is active each can score
 * its attendees on the eVals page.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { EmployeePicker } from "@/components/employee-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { JudgeSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { BootcampRow } from "@/lib/scheduler/bootcamps";
import { formatDate, formatWhen } from "../../cohort-settings/format";
import { STATUS_LABELS } from "../bootcamp-dialog";

export type JudgeListing = {
  id: string;
  email: string;
  fullName: string;
  addedAt: string;
  addedBy: string | null;
};

const COLUMNS: { column: JudgeSort; label: string }[] = [
  { column: "fullName", label: "Name" },
  { column: "email", label: "Email" },
  { column: "addedBy", label: "Added by" },
  { column: "addedAt", label: "Added" },
];

const ERRORS: Record<string, string> = {
  invalid: "Pick someone from the employee list.",
  not_employee: "Only someone in the employee list can judge. Pick them from the list.",
  duplicate: "That person is already a judge at this bootcamp.",
  not_found: "That was already removed — reload the page.",
  forbidden: "Your own role changed — reload the page.",
};

export function JudgesView({
  bootcamp,
  query,
  page,
  canManage,
}: {
  bootcamp: Omit<BootcampRow, "createdAt"> & { createdAt: string };
  query: ListQuery<JudgeSort>;
  page: Page<JudgeListing>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sortProps = { sort: query.sort, dir: query.dir };
  const columns = COLUMNS.length + (canManage ? 1 : 0);
  const base = `/api/scheduler/bootcamps/${bootcamp.id}/judges`;

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
      <motion.div variants={riseChild} className="space-y-4">
        <Link
          href="/scheduler"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Scheduler
        </Link>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-medium tracking-tight">Bootcamp starting {formatDate(bootcamp.startDate)}</h1>
            <Badge variant={bootcamp.status === "active" ? "default" : "secondary"}>
              {STATUS_LABELS[bootcamp.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {bootcamp.btcDays} days
            {bootcamp.intDays !== null && `, with ${bootcamp.intDays} days of intermediate`}
            {bootcamp.createdBy && <>, scheduled by {bootcamp.createdBy}</>}.
          </p>
        </div>
      </motion.div>

      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Guest judges</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">
            {bootcamp.judges.toLocaleString()} {bootcamp.judges === 1 ? "judge" : "judges"}
          </span>
          {bootcamp.status === "active"
            ? ", scoring on the eVals page now."
            : ", able to score on the eVals page once this bootcamp is active."}
        </p>
      </motion.div>

      {canManage && (
        <motion.div variants={riseChild}>
          <EmployeePicker
            id="bootcamp-judge"
            label="Add a judge"
            placeholder="Search employees by name"
            busy={busy === "add"}
            onAdd={async (email) => {
              const body = await send("add", base, { method: "POST", body: JSON.stringify({ email }) });
              if (!body) return false;
              setNotice(`Added ${body.fullName || body.email}.`);
              return true;
            }}
          />
        </motion.div>
      )}

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
        <TableSearch value={query.q} placeholder="Search by name, email or who added them" label="Search judges" />
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
                {canManage && <PlainHeader className="w-16" />}
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={columns} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No judges match that search." : "No judges yet."}
                  </td>
                </tr>
              )}
              {page.rows.map((j) => (
                <tr key={j.id} className="border-b transition-colors last:border-b-0 hover:bg-muted/30">
                  <td className="px-5 py-3 font-medium">{j.fullName || "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{j.email}</td>
                  <td className="px-5 py-3 text-muted-foreground">{j.addedBy ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatWhen(j.addedAt)}</td>
                  {canManage && (
                    <td className="px-5 py-3">
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${j.fullName || j.email}`}
                          disabled={busy === j.id}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={async () => {
                            const body = await send(j.id, `${base}/${j.id}`, { method: "DELETE" });
                            if (body) setNotice(`Removed ${j.fullName || j.email}.`);
                          }}
                        >
                          {busy === j.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="judges" />
        </div>
      </motion.div>
    </motion.div>
  );
}
