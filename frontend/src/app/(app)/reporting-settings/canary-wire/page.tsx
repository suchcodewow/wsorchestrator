/** Reporting Settings → Canary Wire: a place for the Canary Wire's settings, which has none yet. */

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Canary Wire settings" };

export default function CanaryWireSettingsPage() {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-medium tracking-tight">Canary Wire</h2>
      <div className="rounded-2xl border bg-card px-5 py-2.5 text-sm text-muted-foreground shadow-sm">No Canary Wire settings yet.</div>
    </div>
  );
}
