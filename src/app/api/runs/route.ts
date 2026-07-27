import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { createScheduledRun, listRunsForUser } from "@/lib/runs";

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
  workshopId: z.string().uuid(),
  scheduledStart: z.string().datetime(),
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

  const result = await createScheduledRun({
    name: parsed.data.name,
    workshopId: parsed.data.workshopId,
    userId: session.user.id,
    scheduledStart: new Date(parsed.data.scheduledStart),
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ run: result.run }, { status: 201 });
}
