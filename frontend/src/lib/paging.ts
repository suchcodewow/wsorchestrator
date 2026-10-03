/**
 * The one way a table of database rows is fetched: at most PAGE_SIZE rows a
 * query, with the search, sort and page carried in the URL so the page, its
 * GET route and a link to either all agree. The query asks for one row more
 * than it shows, which says whether there is a next page without a count.
 *
 * Pure, so the client components that draw the controls can share it; the
 * Drizzle half is `paging-sql.ts`.
 */

export const PAGE_SIZE = 100;

export const SORT_DIRS = ["asc", "desc"] as const;
export type SortDir = (typeof SORT_DIRS)[number];

/** What a list was asked for: the search text, the sort, and the 1-based page. */
export type ListQuery<S extends string = string> = {
  q: string;
  sort: S;
  dir: SortDir;
  page: number;
};

/** One page of rows, and whether another follows it. */
export type Page<T> = {
  rows: T[];
  page: number;
  hasMore: boolean;
};

export type ListSpec<S extends string> = {
  sorts: readonly S[];
  sort: S;
  dir: SortDir;
};

/** Longer than any search box needs; keeps an ILIKE pattern sane. */
export const MAX_QUERY_LENGTH = 200;

/** The last page anyone could reach by paging; anything past it is a typo or an attack on OFFSET. */
export const MAX_PAGE = 10_000;

type ParamSource =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | undefined;

function read(params: ParamSource, key: string): string | undefined {
  if (!params) return undefined;
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The URL parameter one table's `name` is carried in. A page has one search
 * box, so `q` is shared; each table on it sorts and pages on its own, so a
 * second table's are prefixed: `sales.sort`, `sales.page`.
 */
export function listParam(name: "q" | "sort" | "dir" | "page", prefix = ""): string {
  return name === "q" || !prefix ? name : `${prefix}.${name}`;
}

/**
 * The list a request asked for, from a page's `searchParams` or a route's
 * URL. Anything missing or unrecognised falls back to `spec`'s default, so a
 * hand-typed URL never errors. `prefix` picks one table's parameters on a
 * page that has several; see `listParam`.
 */
export function parseListQuery<S extends string>(
  params: ParamSource,
  spec: ListSpec<S>,
  prefix = "",
): ListQuery<S> {
  const q = (read(params, "q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);

  const askedSort = read(params, listParam("sort", prefix));
  const sort = spec.sorts.includes(askedSort as S) ? (askedSort as S) : spec.sort;

  const askedDir = read(params, listParam("dir", prefix));
  const dir = SORT_DIRS.includes(askedDir as SortDir)
    ? (askedDir as SortDir)
    : sort === spec.sort
      ? spec.dir
      : "asc";

  const asked = Number.parseInt(read(params, listParam("page", prefix)) ?? "", 10);
  const page = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), MAX_PAGE) : 1;

  return { q, sort, dir, page };
}

/**
 * `query` written back as URL parameters, leaving out whatever is already the
 * default, so a link back to a list lands where it was left. The inverse of
 * `parseListQuery`; `params` gets them, beside anything it already has.
 */
export function writeListQuery<S extends string>(
  query: ListQuery<S>,
  spec: ListSpec<S>,
  params = new URLSearchParams(),
  prefix = "",
): URLSearchParams {
  if (query.q) params.set(listParam("q", prefix), query.q);
  if (query.sort !== spec.sort) params.set(listParam("sort", prefix), query.sort);
  if (query.dir !== (query.sort === spec.sort ? spec.dir : "asc")) params.set(listParam("dir", prefix), query.dir);
  if (query.page > 1) params.set(listParam("page", prefix), String(query.page));
  return params;
}

/** `path` with `params`, or just `path` when there are none. */
export function withParams(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** The LIMIT and OFFSET for `page`: one row past the page, to learn whether more follow. */
export function pageWindow(page: number): { limit: number; offset: number } {
  return { limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE };
}

/** Rows fetched with `pageWindow`, as the page they make. */
export function toPage<T>(rows: T[], page: number): Page<T> {
  return {
    rows: rows.slice(0, PAGE_SIZE),
    page,
    hasMore: rows.length > PAGE_SIZE,
  };
}

/** The 1-based row numbers a page covers, for "101–200". */
export function pageRange(page: Page<unknown>): { from: number; to: number } {
  const from = (page.page - 1) * PAGE_SIZE + 1;
  return { from, to: from + page.rows.length - 1 };
}
