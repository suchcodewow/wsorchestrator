"use client";

/**
 * The facilities bootcamps are held at, a page at a time, and the dialog that
 * adds one or changes its rooms. A bootcamp picks its facility; its sessions
 * pick rooms from it.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, Building2, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FACILITY_LIMITS } from "@/db/schema";
import type { FacilitySort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { repeatedRooms, sameRoomName } from "@/lib/scheduler/room-names";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../cohort-settings/format";

export type FacilityListing = {
  id: string;
  name: string;
  rooms: number;
  capacity: number;
  bootcamps: number;
  updatedAt: string;
};

type RoomDraft = { key: string; id?: string; name: string; capacity: string };

const ERRORS: Record<string, string> = {
  invalid: "Give the facility a name, and every room a name and a capacity of at least 1.",
  duplicate: "Another facility has that name.",
  unknown_room: "A room was removed in the meantime — close this and try again.",
  not_found: "That facility was removed — reload the page.",
  forbidden: "Your own role changed — reload the page.",
};

let nextKey = 0;
const blankRoom = (): RoomDraft => ({ key: `new-${nextKey++}`, name: "", capacity: "" });

export function FacilitiesView({ query, page }: { query: ListQuery<FacilitySort>; page: Page<FacilityListing> }) {
  const router = useRouter();
  const [editing, setEditing] = useState<FacilityListing | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sortProps = { sort: query.sort, dir: query.dir };

  async function remove(f: FacilityListing) {
    const held = f.bootcamps > 0 ? ` ${f.bootcamps} ${f.bootcamps === 1 ? "bootcamp is" : "bootcamps are"} held there and will lose their rooms.` : "";
    if (!window.confirm(`Remove ${f.name} and its rooms?${held}`)) return;
    setBusy(f.id);
    setError(null);
    try {
      const res = await fetch(`/api/scheduler/facilities/${f.id}`, { method: "DELETE" });
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
      <motion.div variants={riseChild} className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-medium tracking-tight">Facilities</h2>
        <Button variant="brand" onClick={() => setEditing("new")}>
          <Plus />
          Add facility
        </Button>
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by facility or room" label="Search facilities" />
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
                <SortHeader column="name" {...sortProps}>
                  Facility
                </SortHeader>
                <SortHeader column="rooms" {...sortProps}>
                  Rooms
                </SortHeader>
                <SortHeader column="capacity" {...sortProps}>
                  Capacity
                </SortHeader>
                <PlainHeader>Bootcamps</PlainHeader>
                <SortHeader column="updatedAt" {...sortProps}>
                  Changed
                </SortHeader>
                <PlainHeader className="w-24" />
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No facilities match that search." : "No facilities yet."}
                  </td>
                </tr>
              )}
              {page.rows.map((f) => (
                <tr key={f.id} className="border-b transition-colors last:border-b-0 hover:bg-muted/30">
                  <td className="px-5 py-3 font-medium">
                    <span className="flex items-center gap-2">
                      <Building2 className="size-3.5 text-muted-foreground" />
                      {f.name}
                    </span>
                  </td>
                  <td className="px-5 py-3 tabular-nums">{f.rooms}</td>
                  <td className="px-5 py-3 tabular-nums">{f.capacity.toLocaleString()}</td>
                  <td className="px-5 py-3 tabular-nums text-muted-foreground">{f.bootcamps}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatWhen(f.updatedAt)}</td>
                  <td className="px-5 py-2">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${f.name}`} disabled={busy === f.id} onClick={() => setEditing(f)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${f.name}`}
                        disabled={busy === f.id}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => remove(f)}
                      >
                        {busy === f.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="facilities" />
        </div>
      </motion.div>

      <FacilityDialog editing={editing} onClose={() => setEditing(null)} />
    </motion.div>
  );
}

function FacilityDialog({ editing, onClose }: { editing: FacilityListing | "new" | null; onClose: () => void }) {
  const router = useRouter();
  const open = editing !== null;
  const existing = editing && editing !== "new" ? editing : null;
  const [name, setName] = useState("");
  /** Null while an edited facility's rooms load. */
  const [rooms, setRooms] = useState<RoomDraft[] | null>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [was, setWas] = useState(editing);
  if (editing !== was) {
    setWas(editing);
    if (editing) {
      setName(existing?.name ?? "");
      setRooms(existing ? null : [blankRoom()]);
      setError(null);
    }
  }

  const existingId = existing?.id;
  useEffect(() => {
    if (!existingId) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/scheduler/facilities/${existingId}`, { signal: ctrl.signal });
        const body = res.ok ? await res.json() : null;
        if (!body) return setError(`Could not load its rooms (${res.status}).`);
        setRooms(
          (body.rooms as { id: string; name: string; capacity: number }[]).map((r) => ({
            key: r.id,
            id: r.id,
            name: r.name,
            capacity: String(r.capacity),
          })),
        );
      } catch {
        if (!ctrl.signal.aborted) setError("Could not load its rooms.");
      }
    })();
    return () => ctrl.abort();
  }, [existingId]);

  const total = (rooms ?? []).reduce((sum, r) => sum + (Number(r.capacity) || 0), 0);
  // A room named like one above it is marked, and the facility can't be saved until it is renamed or removed.
  const repeats = new Set(repeatedRooms(rooms ?? []).map((i) => rooms![i]!.key));
  const firstRepeat = rooms?.find((r) => repeats.has(r.key));
  const repeated = firstRepeat && rooms?.find((r) => sameRoomName(r.name, firstRepeat.name));

  function edit(key: string, patch: Partial<RoomDraft>) {
    setRooms((rs) => rs && rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function move(index: number, by: number) {
    setRooms((rs) => {
      if (!rs) return rs;
      const next = [...rs];
      const [r] = next.splice(index, 1);
      next.splice(index + by, 0, r!);
      return next;
    });
  }

  async function save() {
    if (!rooms) return;
    const kept = rooms.filter((r) => r.name.trim() || r.capacity.trim());
    const body = {
      name: name.trim(),
      rooms: kept.map((r) => ({ ...(r.id && { id: r.id }), name: r.name.trim(), capacity: Number(r.capacity) })),
    };
    if (!body.name) return setError("Give the facility a name.");
    if (body.rooms.some((r) => !r.name || !Number.isInteger(r.capacity) || r.capacity < 1)) {
      return setError("Give every room a name and a whole-number capacity of at least 1.");
    }
    if (repeats.size > 0) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(existing ? `/api/scheduler/facilities/${existing.id}` : "/api/scheduler/facilities", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          out?.error === "duplicate_room"
            ? `Two rooms are called ${out.room ?? "the same thing"}.`
            : (ERRORS[out?.error ?? ""] ?? `Could not save (${res.status}).`),
        );
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{existing ? existing.name : "Add facility"}</DialogTitle>
          <DialogDescription className="tabular-nums">
            {rooms ? `${rooms.filter((r) => r.name.trim()).length} rooms, holding ${total.toLocaleString()} together` : "Loading rooms…"}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="grid gap-5"
        >
          <div className="grid gap-1.5">
            <label htmlFor="facility-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="facility-name"
              value={name}
              maxLength={FACILITY_LIMITS.name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="grid gap-2">
            <div className="grid grid-cols-[1fr_6rem_5.5rem] gap-2 text-xs font-medium text-muted-foreground">
              <span>Room</span>
              <span>Holds</span>
              <span />
            </div>
            {rooms === null ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Loading rooms…
              </p>
            ) : (
              <ul className="grid max-h-80 gap-2 overflow-y-auto">
                {rooms.map((r, i) => (
                  <li key={r.key} className="grid grid-cols-[1fr_6rem_5.5rem] items-center gap-2">
                    <Input
                      aria-label={`Room ${i + 1} name`}
                      value={r.name}
                      maxLength={FACILITY_LIMITS.name}
                      placeholder="Room name"
                      aria-invalid={repeats.has(r.key) || undefined}
                      aria-describedby={repeats.has(r.key) ? "room-repeat" : undefined}
                      onChange={(e) => edit(r.key, { name: e.target.value })}
                      className={cn(repeats.has(r.key) && "border-destructive focus-visible:ring-destructive/30")}
                    />
                    <Input
                      aria-label={`Room ${i + 1} capacity`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={FACILITY_LIMITS.capacity}
                      value={r.capacity}
                      placeholder="People"
                      onChange={(e) => edit(r.key, { capacity: e.target.value })}
                      className="tnum"
                    />
                    <div className="flex">
                      <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label="Move down"
                        disabled={i === rooms.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${r.name || `room ${i + 1}`}`}
                        className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setRooms(rooms.filter((other) => other.key !== r.key))}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {repeated && (
              <p id="room-repeat" role="alert" className="text-sm text-destructive">
                There is already a room called {repeated.name.trim()}. Rename or remove one of them.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={rooms === null || rooms.length >= FACILITY_LIMITS.rooms}
              onClick={() => setRooms((rs) => rs && [...rs, blankRoom()])}
            >
              <Plus />
              Add room
            </Button>
            {existing && <p className="text-xs text-muted-foreground">A room removed here is taken off every session that used it.</p>}
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
            <Button type="submit" variant="brand" disabled={pending || rooms === null || repeats.size > 0}>
              {pending && <Loader2 className="animate-spin" />}
              {existing ? "Save" : "Add facility"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
