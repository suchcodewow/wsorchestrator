/**
 * Which build is running.
 *
 * `BUILD_TAG` and `BUILD_TIME` are stamped into the image by
 * [`frontend/Dockerfile`](../../Dockerfile) from build args that
 * [`cloudbuild.yaml`](../../../cloudbuild.yaml) fills in. The tag is the short
 * commit SHA — the unambiguous answer to "what code is this?", which a
 * timestamp alone never is.
 *
 * Read at request time, not inlined: the Next build happens in an earlier
 * Docker stage than the `ENV`, so these only exist once the container starts.
 * That also means a plain `docker build` or `next dev` gets the `dev` fallback
 * rather than a misleading value.
 *
 * Not marked `server-only` so the type can be imported by the client component
 * that renders it; there is nothing sensitive here, only what `docker inspect`
 * would already show.
 */

export type BuildInfo = {
  /** Short commit SHA the image was built from, or `dev` outside a build. */
  tag: string;
  /** Exact build instant (ISO-8601 UTC), or null outside a build. */
  builtAt: string | null;
  /** `builtAt` rendered for display, or null when there is nothing to show. */
  builtAtLabel: string | null;
};

/**
 * Fixed to UTC and to one locale so the server's string and the browser's
 * agree. A locale-aware or relative time would differ between the two and
 * hydrate with a mismatch, for a line nobody reads twice.
 */
const FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

export function buildInfo(): BuildInfo {
  const tag = process.env.BUILD_TAG?.trim() || "dev";
  const raw = process.env.BUILD_TIME?.trim();

  if (!raw) return { tag, builtAt: null, builtAtLabel: null };

  // A malformed stamp should degrade to "no timestamp", never to "Invalid
  // Date" in the corner of every page.
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return { tag, builtAt: null, builtAtLabel: null };
  }

  return {
    tag,
    builtAt: date.toISOString(),
    builtAtLabel: `${FORMAT.format(date)} UTC`,
  };
}
