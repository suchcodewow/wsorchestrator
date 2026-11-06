/**
 * Tells the server a hands-on experience, or one slide of the slide review,
 * has been finished, for Coach Canary Settings → Reporting. Fire and forget:
 * a run that fails to record never interrupts the experience.
 */

type Run =
  | { experience: "developer" }
  | { experience: "security"; score: number }
  | { experience: "slide-review"; seed: number; found: number; wrongClicks: number };

export function recordRun(run: Run): void {
  void fetch("/api/mimir/experiences", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(run),
    // A run can end as the window closes, and the request should outlive it.
    keepalive: true,
  }).catch(() => {});
}
