import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { CLOUDS, MAX_USERS } from "@/db/schema";
import { getRunForUser, updateRunConfig, type UpdateRunError } from "@/lib/runs";
import { reprovisionRun } from "@/lib/trigger";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await getRunForUser(id, session.user.id);
  if (!result) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(result);
}

const patchSchema = z.object({
  userCount: z.number().int().min(1).max(MAX_USERS),
  clouds: z.array(z.enum(CLOUDS)).min(1).max(CLOUDS.length),
});

const STATUS_FOR: Record<UpdateRunError, number> = {
  not_found: 404,
  locked: 409,
  shrink_not_allowed: 409,
  cloud_removal_not_allowed: 409,
  // The body is well-formed; it just breaks the run's own mode caps, which
  // only `updateRunConfig` can see.
  exceeds_mode_limits: 400,
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { id } = await params;
  const result = await updateRunConfig(id, session.user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }

  // A live workshop needs the runner to create the added accounts / clouds.
  const applying = result.needsReprovision ? await reprovisionRun(id) : false;
  return NextResponse.json({ run: result.run, applying });
}
