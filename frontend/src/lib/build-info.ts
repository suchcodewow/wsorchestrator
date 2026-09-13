/** Which build is running. */

export type BuildInfo = {
  tag: string;
  builtAt: string | null;
  builtAtLabel: string | null;
  message: string | null;
};

const FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/**
 * The commit subject the image was built from, base64 in transit.
 *
 * Commit subjects here routinely contain commas, apostrophes and backticks,
 * and every layer carrying this value splits or evaluates on one of those:
 * `gcloud builds submit --substitutions` is a comma-separated list, the
 * Harness build-and-push step joins its buildArgs the same way, and both
 * pipelines interpolate into a shell. Encoding at the source reduces the value
 * to `[A-Za-z0-9+/=]` and makes the whole question moot, at the cost of an
 * opaque ENV in the image.
 */
function commitMessage(): string | null {
  const encoded = process.env.BUILD_MESSAGE_B64?.trim();
  if (!encoded) return null;

  // Decoding never throws — Buffer drops anything that is not base64 — so a
  // mangled value degrades to a short string or an empty one, not a 500.
  const text = Buffer.from(encoded, "base64").toString("utf8");
  return text.replace(/\s+/g, " ").trim() || null;
}

export function buildInfo(): BuildInfo {
  const tag = process.env.BUILD_TAG?.trim() || "dev";
  const raw = process.env.BUILD_TIME?.trim();
  const message = commitMessage();

  if (!raw) return { tag, builtAt: null, builtAtLabel: null, message };

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return { tag, builtAt: null, builtAtLabel: null, message };
  }

  return {
    tag,
    builtAt: date.toISOString(),
    builtAtLabel: `${FORMAT.format(date)} UTC`,
    message,
  };
}
