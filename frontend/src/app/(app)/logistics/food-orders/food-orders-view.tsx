"use client";

/**
 * Food orders, the soonest to arrive first: who each is from, when it
 * arrives, what the training team needs from it, and the vendor's PDF.
 * Training administrators add and change them in a dialog; anyone in
 * Training can open the PDFs and print the list or one order.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { FileText, Loader2, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import {
  HEADER_ROW,
  LINK_ROW,
  Pager,
  PlainHeader,
  SortHeader,
  TableSearch,
  useRowLink,
} from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FOOD_ORDER_LIMITS } from "@/db/schema";
import type { FoodOrderSort } from "@/lib/list-specs";
import type { FoodOrderRow } from "@/lib/logistics/food-orders";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { PRINT_PATH, formatArrival, formatBytes } from "./format";

const ERRORS: Record<string, string> = {
  invalid: "Say who the order is from and when it arrives.",
  not_pdf: "That file is not a PDF.",
  too_large: `The PDF must be under ${FOOD_ORDER_LIMITS.bytes / (1024 * 1024)} MB.`,
  not_found: "That order was removed — reload the page.",
  forbidden: "Your own role changed — reload the page.",
};

export function FoodOrdersView({
  query,
  page,
  canEdit,
}: {
  query: ListQuery<FoodOrderSort>;
  page: Page<FoodOrderRow>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const listParams = useSearchParams().toString();
  const rowLink = useRowLink();
  const [editing, setEditing] = useState<FoodOrderRow | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sortProps = { sort: query.sort, dir: query.dir };

  async function remove(o: FoodOrderRow) {
    if (!window.confirm(`Remove the order from ${o.vendor}, and its PDF?`)) return;
    setBusy(o.id);
    setError(null);
    try {
      const res = await fetch(`/api/logistics/food-orders/${o.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) setError(`Could not remove it (${res.status}).`);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3">
        <TableSearch
          value={query.q}
          placeholder="Search by vendor, what is needed or file name"
          label="Search food orders"
          className="min-w-56 flex-1"
        />
        <Button variant="outline" asChild>
          <Link href={listParams ? `${PRINT_PATH}?${listParams}` : PRINT_PATH} target="_blank">
            <Printer />
            Print list
          </Link>
        </Button>
        {canEdit && (
          <Button variant="brand" onClick={() => setEditing("new")}>
            <Plus />
            Add order
          </Button>
        )}
      </motion.div>

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
                <SortHeader column="arrivesAt" {...sortProps} className="w-48">
                  Arrives
                </SortHeader>
                <SortHeader column="vendor" {...sortProps}>
                  From
                </SortHeader>
                <PlainHeader>What we need</PlainHeader>
                <PlainHeader>PDF</PlainHeader>
                <PlainHeader className="w-28" />
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No food orders match that search." : "No food orders yet."}
                  </td>
                </tr>
              )}
              {page.rows.map((o) => {
                const past = o.arrived;
                return (
                  <tr
                    key={o.id}
                    className={cn(canEdit ? LINK_ROW : "border-b last:border-b-0", "align-top", past && "text-muted-foreground")}
                    onClick={canEdit ? rowLink(() => setEditing(o)) : undefined}
                  >
                    <td className="whitespace-nowrap px-5 py-3 tabular-nums" suppressHydrationWarning>
                      {formatArrival(o.arrivesAt)}
                      {past && <span className="block text-xs">Arrived</span>}
                    </td>
                    <td className="px-5 py-3 font-medium">{o.vendor}</td>
                    <td className="max-w-96 px-5 py-3 whitespace-pre-line">
                      {o.needs || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-5 py-3">
                      {o.fileName ? (
                        <a
                          href={`/api/logistics/food-orders/${o.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-brand hover:underline"
                        >
                          <FileText className="size-3.5 shrink-0" />
                          <span className="max-w-48 truncate">{o.fileName}</span>
                          {o.fileBytes !== null && <span className="text-xs text-muted-foreground">{formatBytes(o.fileBytes)}</span>}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-5 py-2">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" aria-label={`Print the order from ${o.vendor}`} asChild>
                          <Link href={`${PRINT_PATH}?id=${o.id}`} target="_blank">
                            <Printer className="size-3.5" />
                          </Link>
                        </Button>
                        {canEdit && (
                          <>
                            <Button variant="ghost" size="icon" aria-label={`Edit the order from ${o.vendor}`} disabled={busy === o.id} onClick={() => setEditing(o)}>
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove the order from ${o.vendor}`}
                              disabled={busy === o.id}
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => remove(o)}
                            >
                              {busy === o.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="orders" />
        </div>
      </motion.div>

      {canEdit && <FoodOrderDialog editing={editing} onClose={() => setEditing(null)} />}
    </motion.div>
  );
}

/** `iso` as the value a datetime-local input takes, in the browser's own time zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function FoodOrderDialog({ editing, onClose }: { editing: FoodOrderRow | "new" | null; onClose: () => void }) {
  const router = useRouter();
  const existing = editing && editing !== "new" ? editing : null;
  const [vendor, setVendor] = useState("");
  const [arrives, setArrives] = useState("");
  const [needs, setNeeds] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [was, setWas] = useState(editing);
  if (editing !== was) {
    setWas(editing);
    if (editing) {
      setVendor(existing?.vendor ?? "");
      setArrives(existing ? toLocalInput(existing.arrivesAt) : "");
      setNeeds(existing?.needs ?? "");
      setFile(null);
      setRemoveFile(false);
      setError(null);
    }
  }

  async function save() {
    if (!vendor.trim() || !arrives) return setError(ERRORS.invalid!);
    if (file && file.size > FOOD_ORDER_LIMITS.bytes) return setError(ERRORS.too_large!);
    setPending(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("vendor", vendor.trim());
      body.append("arrivesAt", new Date(arrives).toISOString());
      body.append("needs", needs);
      if (file) body.append("file", file);
      else if (removeFile) body.append("removeFile", "1");
      const res = await fetch(existing ? `/api/logistics/food-orders/${existing.id}` : "/api/logistics/food-orders", {
        method: existing ? "PATCH" : "POST",
        body,
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) return setError(ERRORS[out?.error ?? ""] ?? `Could not save (${res.status}).`);
      onClose();
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{existing ? `Order from ${existing.vendor}` : "Add food order"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="grid gap-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="order-vendor" className="text-sm font-medium">
                From
              </label>
              <Input
                id="order-vendor"
                list="order-vendors"
                placeholder="ezCater"
                value={vendor}
                maxLength={FOOD_ORDER_LIMITS.vendor}
                autoFocus
                onChange={(e) => setVendor(e.target.value)}
              />
              <datalist id="order-vendors">
                <option value="ezCater" />
              </datalist>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="order-arrives" className="text-sm font-medium">
                Arrives
              </label>
              <Input id="order-arrives" type="datetime-local" value={arrives} onChange={(e) => setArrives(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="order-needs" className="text-sm font-medium">
              What we need
            </label>
            <Textarea
              id="order-needs"
              rows={5}
              placeholder={"Lunch for 40, 6 vegetarian\nPlates, napkins and serving utensils"}
              value={needs}
              maxLength={FOOD_ORDER_LIMITS.needs}
              onChange={(e) => setNeeds(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="order-file" className="text-sm font-medium">
              PDF
            </label>
            {existing?.fileName && !file && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className={cn("inline-flex items-center gap-1.5", removeFile && "line-through text-muted-foreground")}>
                  <FileText className="size-3.5" />
                  {existing.fileName}
                </span>
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={removeFile}
                    onChange={(e) => setRemoveFile(e.target.checked)}
                    className="size-3.5 accent-brand"
                  />
                  Remove it
                </label>
              </div>
            )}
            <Input
              id="order-file"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {existing?.fileName && <p className="text-xs text-muted-foreground">Choosing a file replaces the one it has.</p>}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {existing ? "Save" : "Add order"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
