"use client";

/** Every presentation: present it, open its speaker notes, or open it to see its slides. Administrators add new ones. */

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { FlaskConical, NotebookText, Play, Plus } from "lucide-react";
import { HEADER_ROW, LINK_ROW, Pager, PlainHeader, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import { usePresenter } from "@/components/presentations/player";
import { Button } from "@/components/ui/button";
import type { PresentationSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { PresentationRow } from "@/lib/presentations/presentations";
import { formatSynced } from "./format";
import { NewPresentationDialog } from "./new-presentation-dialog";

export function PresentationsView({
  query,
  page,
  canManage,
}: {
  query: ListQuery<PresentationSort>;
  page: Page<PresentationRow>;
  canManage: boolean;
}) {
  const rowLink = useRowLink();
  const sortProps = { sort: query.sort, dir: query.dir };
  const [adding, setAdding] = useState(false);

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h1 className="text-3xl font-medium tracking-tight">Presentations</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
            <FlaskConical className="size-3.5" />
            experimental- not for use by children under 8
          </span>
        </div>
        {canManage && (
          <Button variant="brand" onClick={() => setAdding(true)}>
            <Plus />
            New
          </Button>
        )}
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by name" label="Search presentations" className="max-w-md" />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="name" {...sortProps}>
                  Name
                </SortHeader>
                <SortHeader column="slides" {...sortProps} className="w-24">
                  Slides
                </SortHeader>
                <SortHeader column="syncedAt" {...sortProps} className="w-44">
                  Read from Google
                </SortHeader>
                <PlainHeader className="w-64" />
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No presentations match that search." : "No presentations yet."}
                  </td>
                </tr>
              )}
              {page.rows.map((row) => {
                const href = `/presentations/${row.id}`;
                return (
                  <tr key={row.id} className={LINK_ROW} onClick={rowLink(href)}>
                    <td className="px-5 py-3">
                      <Link href={href} className="font-medium group-hover:underline">
                        {row.name}
                      </Link>
                      {row.googleTitle && row.googleTitle !== row.name && (
                        <p className="truncate text-xs text-muted-foreground">{row.googleTitle}</p>
                      )}
                    </td>
                    <td className="px-5 py-3 tabular-nums">{row.slides}</td>
                    <td className="px-5 py-3 tabular-nums" suppressHydrationWarning>
                      {formatSynced(row.syncedAt)}
                    </td>
                    <td className="px-5 py-2">
                      <PresentControls id={row.id} disabled={row.slides === 0} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="presentations" />
        </div>
      </motion.div>

      {adding && <NewPresentationDialog onClose={() => setAdding(false)} />}
    </motion.div>
  );
}

/** Present full screen, and the speaker notes in a tab of their own. */
export function PresentControls({ id, disabled }: { id: string; disabled?: boolean }) {
  const { present, player } = usePresenter(id);
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="brand" disabled={disabled} onClick={() => present()}>
        <Play />
        Present
      </Button>
      <Button size="sm" variant="outline" asChild>
        <a href={`/presentations/${id}/notes`} target="_blank" rel="noopener">
          <NotebookText />
          Speaker notes
        </a>
      </Button>
      {player}
    </div>
  );
}
