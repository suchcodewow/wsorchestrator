"use client";

/** The two switches: Diagnostic and Coach Canary on a person's Live Sessions page. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { noticeDialog } from "@/components/ui/confirm";
import { PillSwitch } from "@/components/pill-switch";
import type { LiveSessionsSettings } from "@/lib/reporting/live-sessions-settings";

const ROWS = [
  { field: "diagnostic", label: "Enable Diagnostic" },
  { field: "coachCanary", label: "Enable Coach Canary" },
] as const;

export function LiveSessionsSettingsView({ initial }: { initial: LiveSessionsSettings }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function change(field: keyof LiveSessionsSettings, on: boolean) {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/live-sessions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: on }),
      });
      if (!res.ok) {
        await noticeDialog({ title: "Could not save", description: "The setting was not changed. Try again." });
        return;
      }
      setSettings(await res.json());
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-medium tracking-tight">Live Sessions</h2>
      <div className="divide-y rounded-2xl border bg-card shadow-sm">
        {ROWS.map(({ field, label }) => (
          <div key={field} className="px-5 py-2.5">
            <PillSwitch label={label} on={settings[field]} disabled={saving} onChange={(on) => void change(field, on)} />
          </div>
        ))}
      </div>
    </div>
  );
}
