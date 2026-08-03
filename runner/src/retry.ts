/**
 * Retry with exponential backoff for the flaky HTTP surfaces the runner talks
 * to — chiefly the Google Admin SDK, whose front end occasionally answers a
 * perfectly valid request with a transient 5xx (a raw HTML "Error 502" page,
 * not a JSON API error). One such blip used to kill an entire provision: a
 * single `users.insert` 502 propagated straight out and marked the run failed,
 * with the HTML page stored verbatim as the error.
 *
 * `harness.ts` already carries its own copy of this idea for the Harness API;
 * this module is the reusable version, used by `directory.ts`.
 */

/** Longest error string we ever surface — keeps HTML blobs out of the UI. */
const MAX_SUMMARY_LEN = 600;

/** How many times a transient failure is tried before giving up (incl. first). */
const DEFAULT_ATTEMPTS = 4;

/** First backoff; doubles each retry. 1s → 2s → 4s, as in `harness.ts`. */
const DEFAULT_BASE_DELAY_MS = 1000;

/** HTTP statuses worth another attempt: the rate limiter and transient 5xx. */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Node socket/DNS error codes that are almost always a passing hiccup. */
const TRANSIENT_NET = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "ECONNABORTED",
  "ERR_NETWORK",
]);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The HTML body of an error response, if the error carries one. */
function htmlBodyOf(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { message?: unknown; response?: { data?: unknown } };
  const data = e.response?.data;
  const body =
    typeof data === "string"
      ? data
      : typeof e.message === "string"
        ? e.message
        : "";
  return /<!doctype html|<html[\s>]/i.test(body) ? body : undefined;
}

/** Pull an HTTP status out of a Google HTML error page ("Error 502 …"). */
function statusFromHtml(html: string | undefined): number | undefined {
  if (!html) return undefined;
  const m = html.match(/Error\s+(\d{3})/i) ?? html.match(/\b([45]\d\d)\b/);
  return m ? Number(m[1]) : undefined;
}

/**
 * HTTP status carried by a googleapis / gaxios error, if any. gaxios spreads it
 * across a few fields depending on where the failure happened, and a Google
 * front-end 5xx arrives as an HTML page whose status only survives in the body.
 */
export function httpStatusOf(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null) {
    const e = err as {
      status?: unknown;
      code?: unknown;
      response?: { status?: unknown };
    };
    for (const c of [e.status, e.code, e.response?.status]) {
      // Network errors put a string like "ECONNRESET" in `code`; Number()s to
      // NaN and is skipped, which is exactly right — that is not an HTTP status.
      const n = typeof c === "string" ? Number(c) : c;
      if (typeof n === "number" && Number.isFinite(n) && n >= 100 && n < 600) {
        return n;
      }
    }
  }
  return statusFromHtml(htmlBodyOf(err));
}

/** Network error code on the error itself or, for `fetch`, on its `cause`. */
function networkCodeOf(err: unknown): string | undefined {
  for (const source of [err, (err as { cause?: unknown })?.cause]) {
    // undici wraps a socket failure as `TypeError: fetch failed` and keeps the
    // real code (ECONNRESET, …) on `.cause`, so both places must be checked.
    const code = (source as { code?: unknown })?.code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** Whether the failure is the kind a second attempt might get past. */
export function isTransient(err: unknown): boolean {
  const status = httpStatusOf(err);
  if (status !== undefined && TRANSIENT_STATUS.has(status)) return true;

  const code = networkCodeOf(err);
  if (code !== undefined && TRANSIENT_NET.has(code)) return true;

  // A Google front-end 5xx sometimes arrives as an HTML page with no status we
  // can parse at all; the page itself is the signal it is server-side.
  if (htmlBodyOf(err) && (status === undefined || status >= 500)) return true;

  return false;
}

/**
 * A short, human one-liner for an error — never the multi-kilobyte HTML page a
 * Google 5xx ships. A recognised server-side blip is named as such (and, when
 * the page is Google's, attributed to Google) so the run log says where the
 * fault actually lies instead of dumping markup.
 */
export function summarize(err: unknown): string {
  const status = httpStatusOf(err);
  const html = htmlBodyOf(err);
  if (html) {
    const who = /google\.com/i.test(html) ? "Google" : "the upstream server";
    return `${who} returned HTTP ${status ?? "5xx"} (a transient server-side error)`;
  }

  const raw = err instanceof Error ? err.message : String(err);
  const oneLine = raw.replace(/\s+/g, " ").trim();
  const withStatus =
    status !== undefined && !oneLine.includes(String(status))
      ? `HTTP ${status}: ${oneLine}`
      : oneLine;
  return withStatus.length > MAX_SUMMARY_LEN
    ? `${withStatus.slice(0, MAX_SUMMARY_LEN - 1)}…`
    : withStatus;
}

/** A retry attempt, handed to `onRetry` for logging. */
export type RetryInfo = {
  /** 1-based index of the attempt that just failed. */
  attempt: number;
  /** Total attempts that will be made before giving up. */
  attempts: number;
  /** How long we will wait before the next attempt. */
  delayMs: number;
  /** The (transient) error that triggered the retry. */
  error: unknown;
  /** `summarize(error)`, ready to log. */
  summary: string;
};

export type RetryOptions = {
  /**
   * What is being called, e.g. "Google Workspace Directory (create user)".
   * Prefixes the give-up error so the run log names the culprit system.
   */
  label: string;
  attempts?: number;
  baseDelayMs?: number;
  /** Called before each backoff; awaited, so ordered log writes are safe. */
  onRetry?: (info: RetryInfo) => void | Promise<void>;
};

/**
 * Run `fn`, retrying it on transient failures with exponential backoff.
 *
 * A *non-transient* error is re-thrown unchanged and immediately, so callers
 * can still inspect its status (the 409/404 "already exists / already gone"
 * idempotency checks in `directory.ts` depend on this). Only when a transient
 * failure exhausts every attempt is the error replaced — with a short one-liner
 * that names the system and says the fault is on its side, not the caller's.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  const base = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Preserve the original error for the caller's status checks.
      if (!isTransient(err)) throw err;

      if (attempt >= attempts) {
        throw new Error(
          `${opts.label} kept failing after ${attempts} attempts — ` +
            `${summarize(err)}. This is a problem on the provider's side, ` +
            `not the workshop configuration; try the run again.`,
        );
      }

      const delayMs = base * 2 ** (attempt - 1);
      await opts.onRetry?.({
        attempt,
        attempts,
        delayMs,
        error: err,
        summary: summarize(err),
      });
      await wait(delayMs);
    }
  }
}
