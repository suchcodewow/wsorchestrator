"use client";

/** The search box and role pills over a Canary Wire table, shared by its two tabs. */

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PILL, PILL_ON } from "./ui";

export function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="relative w-full max-w-64 min-w-48 flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by name, manager or title"
        aria-label={label}
        className="rounded-full pl-9"
      />
    </div>
  );
}

/** All, then a pill per role with how many reps are in it, as Bootcamp History filters by status. */
export function RolePills({
  roles,
  short,
  value,
  onChange,
}: {
  /** Every rep's role, one entry per rep. */
  roles: string[];
  short: (edition: string) => string;
  value: string;
  onChange: (role: string) => void;
}) {
  const counts = new Map<string, number>();
  for (const r of roles) counts.set(r, (counts.get(r) ?? 0) + 1);
  const pills: [string, string, number][] = [
    ["", "All", roles.length],
    ...[...counts].sort(([a], [b]) => (a < b ? -1 : 1)).map(([r, n]): [string, string, number] => [r, short(r), n]),
  ];
  return (
    <div role="group" aria-label="Role" className="flex flex-wrap gap-2">
      {pills.map(([role, label, n]) => (
        <button
          key={role || "all"}
          type="button"
          title={role || "Every role"}
          aria-pressed={value === role}
          onClick={() => onChange(role)}
          className={cn(PILL, value === role && PILL_ON)}
        >
          {label}
          <span className="font-medium tabular-nums text-foreground">{n}</span>
        </button>
      ))}
    </div>
  );
}
