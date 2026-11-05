/**
 * Tells the server a hands-on experience, or one slide of the slide review,
 * has been finished, for Coach Canary Settings → Reporting. Fire and forget:
 * a run that fails to record never interrupts the experience.
 */

import type { ExperienceId } from "@/lib/mimir/experiences";

export function recordRun(run: { experience: ExperienceId; part?: string; score?: number }): void {
  void fetch("/api/mimir/experiences", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(run),
    // A run can end as the window closes, and the request should outlive it.
    keepalive: true,
  }).catch(() => {});
}
