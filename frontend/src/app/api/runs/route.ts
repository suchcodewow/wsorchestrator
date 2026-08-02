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
  limitsFor,
} from "@/db/schema";
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
    // Absent on requests written before challenges existed.
    mode: z.enum(EVENT_MODES).default("workshop"),
    userCount: z.number().int().min(1).max(MAX_USERS),
    // How many days the event runs before teardown. Absent on requests
    // written before the field existed, which fall back to the default.
    ttlDays: z.number().int().min(1).max(MAX_TTL_DAYS).default(DEFAULT_TTL_DAYS),
    clouds: z.array(z.enum(CLOUDS)).min(1).max(CLOUDS.length),
    // Omitted when startNow is set — the run begins immediately instead.
    scheduledStart: z.string().datetime().optional(),
    startNow: z.boolean().optional(),
  })
  // The caps above are the loosest any mode allows; narrow them to the mode
  // actually asked for, so a challenge can't be posted with 50 users and
  // three clouds by skipping the form.
  .superRefine((v, ctx) => {
    const limits = limitsFor(v.mode);
    if (v.userCount > limits.maxUsers) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["userCount"],
        message: `a ${v.mode} allows at most ${limits.maxUsers} user(s)`,
      });
    }
    if (new Set(v.clouds).size > limits.maxClouds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clouds"],
        message: `a ${v.mode} allows at most ${limits.maxClouds} cloud(s)`,
      });
    }
  });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
    userId: session.user.id,
    // A start-now run is backdated so the scheduler still claims it if the
    // direct trigger below fails.
    scheduledStart: startNow ? new Date() : new Date(scheduledStart!),
    startNow,
  });

  const started = startNow ? await startRunNow(result.run.id) : false;
  return NextResponse.json({ run: result.run, started }, { status: 201 });
}
