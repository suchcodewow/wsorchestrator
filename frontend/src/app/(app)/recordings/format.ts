/** How times read on the Recordings pages. */

/** `Oct 9, 2:05 PM`, in the browser's own time zone. */
export const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
