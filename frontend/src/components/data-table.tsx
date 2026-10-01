"use client";

/**
 * The controls every database-backed table shares: a search box, sortable
 * column headers and a pager. They hold no rows themselves. Each writes
 * `q`, `sort`, `dir` and `page` into the URL, the server component reads them
 * back with `parseListQuery`, and the database returns one page of at most
 * `PAGE_SIZE` rows — so a search or a sort is a query, never a filter over
 * everything the browser was sent. See `src/lib/paging.ts`.
 */

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listParam, pageRange, type Page, type SortDir } from "@/lib/paging";
import { cn } from "@/lib/utils";

/** How long the search box waits after the last keystroke before it queries. */
const SEARCH_DEBOUNCE_MS = 300;

type ListChange = Partial<Record<"q" | "sort" | "dir" | "page", string | null>>;

/**
 * Sets one table's list parameters in the URL (`prefix` names the table when
 * a page has several; see `listParam`). Any change but a page turn starts
 * again at page 1 — every table's page 1, for a search, since they share it:
 * page 4 of a different search is not a place anyone means to go.
 */
export function useListParams(prefix = "") {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(changes: ListChange) {
    const next = new URLSearchParams(params.toString());
    for (const [name, value] of Object.entries(changes) as [keyof ListChange, string | null][]) {
      const key = listParam(name, prefix);
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    if ("q" in changes) {
      for (const key of [...next.keys()]) if (key === "page" || key.endsWith(".page")) next.delete(key);
    } else if (!("page" in changes)) {
      next.delete(listParam("page", prefix));
    }
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return { set, pending };
}

export function TableSearch({
  value,
  placeholder,
  label,
  className,
}: {
  /** The search the current page was queried with. */
  value: string;
  placeholder: string;
  label: string;
  className?: string;
}) {
  const { set, pending } = useListParams();
  const [text, setText] = useState(value);
  const sent = useRef(value);

  // Follow the URL when it changes underneath us (back button, a link).
  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    const q = text.trim();
    if (q === sent.current) return;
    const t = setTimeout(() => {
      sent.current = q;
      set({ q });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // `set` changes identity every render; the text is what drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className={cn("relative w-full max-w-sm", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="pl-9 pr-9"
      />
      {pending && (
        <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

/** A `<th>` whose button sorts the table by `column` on the server. */
export function SortHeader<S extends string>({
  column,
  sort,
  dir,
  prefix,
  children,
  className,
}: {
  column: S;
  sort: S;
  dir: SortDir;
  /** Which table on the page, when there are several. */
  prefix?: string;
  children: ReactNode;
  className?: string;
}) {
  const { set } = useListParams(prefix);
  const active = sort === column;
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-5 py-2.5 font-medium", className)}
    >
      <button
        type="button"
        onClick={() => set({ sort: column, dir: active && dir === "asc" ? "desc" : "asc" })}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 whitespace-nowrap uppercase tracking-wider outline-none hover:text-foreground focus-visible:text-foreground",
          active && "text-foreground",
        )}
      >
        {children}
        <Icon className={cn("size-3", !active && "opacity-40")} />
      </button>
    </th>
  );
}

/** A plain `<th>` styled like `SortHeader`, for a column that does not sort. */
export function PlainHeader({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cn("px-5 py-2.5 font-medium uppercase tracking-wider", className)}>{children}</th>
  );
}

/** The row class every sortable table's header row uses. */
export const HEADER_ROW = "border-b bg-muted/30 text-left text-[11px] text-muted-foreground";

/**
 * "101–200", with Previous and Next. Renders nothing when everything fits on
 * the first page, which is most tables most of the time.
 */
export function Pager({ page, noun = "rows", prefix }: { page: Page<unknown>; noun?: string; prefix?: string }) {
  const { set, pending } = useListParams(prefix);
  if (page.page === 1 && !page.hasMore) return null;
  const { from, to } = pageRange(page);
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 text-xs text-muted-foreground">
      <span className="tabular-nums">
        {page.rows.length ? (
          <>
            {from.toLocaleString()}–{to.toLocaleString()} {noun}
          </>
        ) : (
          <>No {noun} on page {page.page.toLocaleString()}</>
        )}
      </span>
      <div className="flex items-center gap-2">
        {pending && <Loader2 className="size-3.5 animate-spin" />}
        <Button
          variant="outline"
          size="sm"
          disabled={page.page <= 1 || pending}
          onClick={() => set({ page: page.page - 1 > 1 ? String(page.page - 1) : null })}
        >
          <ChevronLeft className="size-4" /> Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!page.hasMore || pending}
          onClick={() => set({ page: String(page.page + 1) })}
        >
          Next <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
