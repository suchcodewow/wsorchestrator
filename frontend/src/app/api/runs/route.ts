/** Lists events, and books a new one. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  CLOUDS,
  DAY_SECONDS,
  DEFAULT_TTL_DAYS,
  EVENT_MODES,
  MAX_TTL_DAYS,
  MAX_USERS,
  SCENARIOS,
  limitsFor,
  type ScenarioId,
} from "@/db/schema";
import { canCreateEvents } from "@/lib/roles";
import { createScheduledRun, listRunsForUser } from "@/lib/runs";
import { startRunNow } from "@/lib/trigger";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const runs = await listRunsForUser(session.user.id);
  return NextResponse.json({ runs });
}

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    mode: z.enum(EVENT_MODES).default("workshop"),
    userCount: z.number().int().min(1).max(MAX_USERS),
    ttlDays: z.number().int().min(1).max(MAX_TTL_DAYS).default(DEFAULT_TTL_DAYS),
    clouds: z.array(z.enum(CLOUDS)).max(CLOUDS.length),
    scenarios: z
      .array(z.enum(SCENARIOS.map((s) => s.id) as [ScenarioId, ...ScenarioId[]]))
      .max(SCENARIOS.length)
      .default([]),
    scheduledStart: z.string().datetime().optional(),
    startNow: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const limits = limitsFor(v.mode);
    if (v.userCount > limits.maxUsers) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["userCount"],
        message: `a ${v.mode} allows at most ${limits.maxUsers} user(s)`,
      });
    }
    const cloudCount = new Set(v.clouds).size;
    if (cloudCount > limits.maxClouds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clouds"],
        message: `a ${v.mode} allows at most ${limits.maxClouds} cloud(s)`,
      });
    }
    if (cloudCount < limits.minClouds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clouds"],
        message: `a ${v.mode} needs at least ${limits.minClouds} cloud(s)`,
      });
    }
    // A scenario builds on a cloud environment, so selecting one for a cloud
    // this event does not run on describes something that can never be applied.
    const stranded = v.scenarios.filter((id) => {
      const scenario = SCENARIOS.find((s) => s.id === id);
      return !scenario || !v.clouds.includes(scenario.cloud);
    });
    if (stranded.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenarios"],
        message: `scenario(s) ${stranded.join(", ")} need a cloud this event does not run on`,
      });
    }
  });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!canCreateEvents(session.user.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { startNow, scheduledStart } = parsed.data;
  if (!startNow && !scheduledStart) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = await createScheduledRun({
    name: parsed.data.name,
    mode: parsed.data.mode,
    userCount: parsed.data.userCount,
    ttlSeconds: parsed.data.ttlDays * DAY_SECONDS,
    clouds: [...new Set(parsed.data.clouds)],
    scenarios: [...new Set(parsed.data.scenarios)] as ScenarioId[],
    userId: session.user.id,
    scheduledStart: startNow ? new Date() : new Date(scheduledStart!),
    startNow,
  });

  const started = startNow ? await startRunNow(result.run.id) : false;
  return NextResponse.json({ run: result.run, started }, { status: 201 });
}
