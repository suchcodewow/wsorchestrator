"use client";

/** The bootcamps, latest first, and for an administrator the means to schedule, change and remove them. */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { CalendarPlus, ChevronRight, Loader2, Pencil, Trash2 } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BootcampSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { BootcampRow } from "@/lib/scheduler/bootcamps";
import type { CopySource } from "@/lib/scheduler/schedule";
import { formatDate } from "../cohort-settings/format";
import { BootcampDialog, STATUS_BADGES, STATUS_LABELS } from "./bootcamp-dialog";

export function SchedulerView({
  query,
  page,
  canManage,
  facilities,
  sources,
}: {
  query: ListQuery<BootcampSort>;
  page: Page<BootcampRow>;
  canManage: boolean;
  facilities: { id: string; name: string }[];
  /** Schedules a new bootcamp can start from. */
  sources: CopySource[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BootcampRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sortProps = { sort: query.sort, dir: query.dir };
  const columns = canManage ? 7 : 6;

  function open(row: BootcampRow | null) {
    setEditing(row);
    setDialogOpen(true);
  }

  async function remove(row: BootcampRow) {
    if (!window.confirm(`Remove the bootcamp starting ${formatDate(row.startDate)}?`)) return;
    setBusy(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/scheduler/bootcamps/${row.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (body?.error === "has_scores") {
        setError(`The bootcamp starting ${formatDate(row.startDate)} has assessments scored at it, so it is kept.`);
      } else if (!res.ok && res.status !== 404) {
        setError(`Could not remove it (${res.status}).`);
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-4">
      {canManage && (
        <motion.div variants={riseChild} className="flex justify-end">
          <Button variant="brand" onClick={() => open(null)}>
            <CalendarPlus />
            Schedule Next Bootcamp
          </Button>
        </motion.div>
      )}

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="startDate" {...sortProps}>
                  Start date
                </SortHeader>
                <PlainHeader>Bootcamp days</PlainHeader>
                <PlainHeader>Intermediate days</PlainHeader>
                <PlainHeader>Facility</PlainHeader>
                <SortHeader column="status" {...sortProps}>
                  Status
                </SortHeader>
                <SortHeader column="createdBy" {...sortProps}>
                  Scheduled by
                </SortHeader>
                {canManage && <PlainHeader className="w-24" />}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row) => (
                <tr
                  key={row.id}
                  className="group cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/30"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("button, a")) return;
                    router.push(`/scheduler/${row.id}`);
                  }}
                >
                  <td className="px-5 py-2.5 font-medium tabular-nums">
                    <Link href={`/scheduler/${row.id}`} className="inline-flex items-center gap-1 hover:underline">
                      {formatDate(row.startDate)}
                      <ChevronRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  </td>
                  <td className="px-5 py-2.5 tabular-nums">{row.btcDays}</td>
                  <td className="px-5 py-2.5 tabular-nums">{row.intDays ?? "—"}</td>
                  <td className="px-5 py-2.5 text-muted-foreground">{row.facilityName ?? "—"}</td>
                  <td className="px-5 py-2.5">
                    <Badge variant={STATUS_BADGES[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                  </td>
                  <td className="px-5 py-2.5 text-muted-foreground">{row.createdBy ?? "—"}</td>
                  {canManage && (
                    <td className="px-5 py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit the bootcamp starting ${formatDate(row.startDate)}`}
                          disabled={busy === row.id}
                          onClick={() => open(row)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove the bootcamp starting ${formatDate(row.startDate)}`}
                          disabled={busy === row.id}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => remove(row)}
                        >
                          {busy === row.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={columns} className="px-5 py-8 text-center text-muted-foreground">
                    No bootcamps scheduled yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="bootcamps" />
        </div>
      </motion.div>

      {canManage && (
        <BootcampDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} facilities={facilities} sources={sources} />
      )}
    </motion.div>
  );
}
