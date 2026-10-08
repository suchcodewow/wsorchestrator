/**
 * Mimir's coaching settings: the platform facts every sales-facing prompt
 * carries, and the module names the coach must never guess at. Both are
 * content, so Training Administrators edit them in Mimir Settings → Coaching;
 * until someone does, the defaults below are used.
 */

import "server-only";

import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { MIMIR_SETTING_MAX, MIMIR_SETTINGS_KEYS, mimirSettings, users } from "@/db/schema";

export const DEFAULT_PLATFORM_CONTEXT = `Key Harness platform context:
- Platform tagline: "AI for Everything After Code"
- Harness is a 2025 Gartner Magic Quadrant Leader for DevOps Platforms
- Harness sells four AI agents. Each agent is made of capabilities; Harness no longer talks about "modules".
  - Software Delivery Agent (move changes safely to production): Deployments (Continuous Delivery & GitOps), Builds (Continuous Integration, including AI test automation), Infrastructure (Infrastructure as Code Management), Databases (Database DevOps), Artifacts (Artifact Registry), Repositories (Code Repository), Code Review (AI Code Review)
  - Security Testing Agent (find and fix risk before production): SAST, SCA, Supply Chain Security, Security Testing Orchestration
  - Runtime Protection Agent (protect apps, APIs and AI in production): API Posture, API Advanced Protection, AI Posture, AI Firewall — formerly WAAP (Traceable) and AI Security
  - Cost Management Agent (control cloud and AI costs): AI & Cloud Costs (Cloud & AI Cost Management, formerly CCM/CACM), Engineering Efficiency (AI DLC Insights, AIDI, formerly SEI)
- More products, sold beside the agents: Incidents (AI SRE), Developer Portal (IDP), Resilience Testing, AI Evals, Runtime Configuration (Feature Management & Experimentation)
- Underneath every agent: the SDLC Knowledge Graph (shared delivery context), with expert agents that reason and worker agents that execute governed workflows, and policy as code, RBAC and an immutable audit trail
- CI: 8× faster (homepage claim)
- WAAP powered by Traceable (merged Feb 2025) — agentless eBPF, behavioral baseline per endpoint
- Mythos: AI-assisted exploitation changes threat model — attacks look like valid users at machine speed`;

export const DEFAULT_NAMING_GUARD = `HARNESS NAMING — Harness sells four agents (Software Delivery Agent, Security Testing Agent, Runtime Protection Agent, Cost Management Agent), each made of capabilities, plus a few more products. Never call anything a "module"; say "capability", and name the agent it belongs to. Use canonical names and never guess an expansion from an abbreviation: "AIDI" is AI DLC Insights (NOT "AI-Driven Insights"); "CACM" is Cloud & AI Cost Management. If you are unsure of a name, use the abbreviation on its own rather than inventing an expansion.`;

export type CoachingSettings = {
  platformContext: string;
  namingGuard: string;
  /** When either was last saved, and by whom; null while both are the defaults. */
  updatedAt: Date | null;
  updatedBy: string | null;
};

export async function getCoachingSettings(): Promise<CoachingSettings> {
  const rows = await db
    .select({
      key: mimirSettings.key,
      value: mimirSettings.value,
      updatedAt: mimirSettings.updatedAt,
      updatedBy: users.name,
    })
    .from(mimirSettings)
    .leftJoin(users, eq(users.id, mimirSettings.updatedBy))
    .where(inArray(mimirSettings.key, Object.values(MIMIR_SETTINGS_KEYS)));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const latest = rows.reduce<(typeof rows)[number] | null>(
    (a, r) => (!a || r.updatedAt > a.updatedAt ? r : a),
    null,
  );
  return {
    platformContext: byKey.get(MIMIR_SETTINGS_KEYS.platformContext)?.value ?? DEFAULT_PLATFORM_CONTEXT,
    namingGuard: byKey.get(MIMIR_SETTINGS_KEYS.namingGuard)?.value ?? DEFAULT_NAMING_GUARD,
    updatedAt: latest?.updatedAt ?? null,
    updatedBy: latest?.updatedBy ?? null,
  };
}

export const coachingSettingsSchema = z.object({
  platformContext: z.string().trim().max(MIMIR_SETTING_MAX),
  namingGuard: z.string().trim().max(MIMIR_SETTING_MAX),
});

export type CoachingSettingsInput = z.infer<typeof coachingSettingsSchema>;

/** Saves both. A conversation already under way keeps the prompt it started with. */
export async function setCoachingSettings(actorId: string, input: CoachingSettingsInput): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const [key, value] of [
      [MIMIR_SETTINGS_KEYS.platformContext, input.platformContext],
      [MIMIR_SETTINGS_KEYS.namingGuard, input.namingGuard],
    ] as const) {
      await tx
        .insert(mimirSettings)
        .values({ key, value, updatedBy: actorId, updatedAt: now })
        .onConflictDoUpdate({ target: mimirSettings.key, set: { value, updatedBy: actorId, updatedAt: now } });
    }
  });
}
