/** Which build is running. */

export type BuildInfo = {
  tag: string;
  builtAt: string | null;
  builtAtLabel: string | null;
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

export function buildInfo(): BuildInfo {
  const tag = process.env.BUILD_TAG?.trim() || "dev";
  const raw = process.env.BUILD_TIME?.trim();

  if (!raw) return { tag, builtAt: null, builtAtLabel: null };

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
