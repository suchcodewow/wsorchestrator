"use client";

/**
 * Mimir's content as a table, filtered by kind and searched on the server,
 * each row opening its editor; with an import that loads a file of items,
 * updating those it already has.
 */

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { FilePlus2, Loader2, Upload } from "lucide-react";
import { HEADER_ROW, LINK_ROW, Pager, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { MIMIR_KINDS, type MimirKind } from "@/db/schema";
import type { MimirItemSort } from "@/lib/list-specs";
import { KIND_LABELS } from "@/lib/mimir/kinds";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { formatWhen } from "../../cohort-settings/format";
import { ChipNav } from "../../mimir/chip-nav";

type Row = { id: string; kind: MimirKind; parentId: string | null; position: number; title: string; emoji: string; updatedAt: string };

const LIST = "/mimir-settings/content";

const COLUMNS: { column: MimirItemSort; label: string }[] = [
  { column: "title", label: "Title" },
  { column: "kind", label: "Kind" },
  { column: "position", label: "Order" },
  { column: "updatedAt", label: "Updated" },
];

const IMPORT_ERRORS: Record<string, string> = {
  no_file: "Choose a file to import.",
  not_json: "That file isn't JSON.",
  too_large: "That file is over 8 MB.",
  bad_parent: "An item's parent is missing or the wrong kind",
  kind_fixed: "An item would change the kind of one that exists",
  taken: "Two items in the file share an id",
};

export function ContentView({
  query,
  kind,
  count,
  page,
}: {
  query: ListQuery<MimirItemSort>;
  kind: MimirKind | null;
  count: number;
  page: Page<Row>;
}) {
  const rowLink = useRowLink();
  const sortProps = { sort: query.sort, dir: query.dir };

  return (
    <motion.div variants={staggerParent(0.04)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <h2 className="text-xl font-medium tracking-tight">Content</h2>
          <p className="text-sm text-muted-foreground tnum">
            <span className="font-medium text-foreground">{count.toLocaleString()}</span> items
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ImportButton />
          <Button variant="brand" asChild>
            <Link href={kind ? `${LIST}/new?kind=${kind}` : `${LIST}/new`}>
              <FilePlus2 />
              New item
            </Link>
          </Button>
        </div>
      </motion.div>

      <motion.div variants={riseChild}>
        <ChipNav
          label="Kinds"
          chips={[
            { href: LIST, label: "All", active: kind === null },
            ...MIMIR_KINDS.map((k) => ({ href: `${LIST}?kind=${k}`, label: KIND_LABELS[k].many, active: k === kind })),
          ]}
        />
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search titles and text" label="Search content" />
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
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "Nothing matches that search." : "No content yet. Import a file or make an item."}
                  </td>
                </tr>
              )}
              {page.rows.map((r) => {
                const href = `${LIST}/${encodeURIComponent(r.id)}`;
                return (
                  <tr key={r.id} className={LINK_ROW} onClick={rowLink(href)}>
                    <td className="max-w-md px-5 py-3 font-medium">
                      <Link href={href} className="inline-flex items-center gap-2 group-hover:underline">
                        {r.emoji && <span aria-hidden>{r.emoji}</span>}
                        <span className="truncate">{r.title}</span>
                      </Link>
                      <span className="block text-xs font-normal text-muted-foreground">{r.id}</span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{KIND_LABELS[r.kind].one}</td>
                    <td className="px-5 py-3 text-muted-foreground tnum">{r.position}</td>
                    <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">{formatWhen(r.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="items" />
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Loads a JSON file of items through POST /api/mimir/import, and says what it did. */
function ImportButton() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/mimir/import", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const where = body?.id ? ` (item ${body.id})` : body?.path ? ` (at ${body.path}: ${body.message})` : "";
        setMessage({ ok: false, text: `${IMPORT_ERRORS[body?.error ?? ""] ?? `Import failed (${res.status})`}${where}. Nothing was changed.` });
        return;
      }
      setMessage({ ok: true, text: `Imported: ${body.created} new, ${body.updated} updated.` });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Could not reach the server." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <Upload />}
        Import
      </Button>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
