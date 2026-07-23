import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { createRun, listRunsForUser } from "@/lib/runs";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const runs = await listRunsForUser(session.user.id);
  return NextResponse.json({ runs });
}

const createSchema = z.object({ workshopId: z.string().uuid() });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = await createRun(parsed.data.workshopId, session.user.id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ run: result.run }, { status: 201 });
}
