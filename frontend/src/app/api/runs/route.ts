import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { CLOUDS, MAX_USERS } from "@/db/schema";
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

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  userCount: z.number().int().min(1).max(MAX_USERS),
  clouds: z.array(z.enum(CLOUDS)).min(1).max(CLOUDS.length),
  // Omitted when startNow is set — the run begins immediately instead.
  scheduledStart: z.string().datetime().optional(),
  startNow: z.boolean().optional(),
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
    userCount: parsed.data.userCount,
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
