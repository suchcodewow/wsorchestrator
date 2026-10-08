/** How Food orders and its print sheet write arrival times and file sizes. */

export const PRINT_PATH = "/logistics/food-orders/print";

const ARRIVAL = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "Tue, Nov 17, 11:30 AM", in the viewer's own time zone, as the rest of the app writes times. */
export function formatArrival(iso: string): string {
  return ARRIVAL.format(new Date(iso));
}

/** "240 KB", "1.2 MB". */
export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
