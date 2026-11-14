/** When a deck was last read from Google, as the Presentations pages show it. */

const WHEN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const formatSynced = (iso: string) => WHEN.format(new Date(iso));
