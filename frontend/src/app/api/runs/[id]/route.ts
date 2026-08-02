import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { CLOUDS, MAX_USERS } from "@/db/schema";
import {
  deleteRun,
  getRunForViewer,
  updateRunConfig,
  type DeleteRunError,
  type UpdateRunError,
  type Viewer,
} from "@/lib/runs";
import { reprovisionRun } from "@/lib/trigger";

/** The signed-in viewer, or null — every handler starts the same way. */
async function viewer(): Promise<Viewer | null> {
  const session = await auth();
  if (!session?.user) return null;
  return { id: session.user.id, role: session.user.siteRole };
}

const UNAUTHORIZED = NextResponse.json(
  { error: "unauthorized" },
  { status: 401 },
);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const who = await viewer();
  if (!who) return UNAUTHORIZED;

  const { id } = await params;
  const result = await getRunForViewer(id, who);
  if (!result) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(result);
}

const patchSchema = z.object({
  userCount: z.number().int().min(1).max(MAX_USERS),
  // May be empty (a no-cloud workshop uses the shared testing project). The
  // per-mode floor is enforced in updateRunConfig, which knows the run's mode.
  clouds: z.array(z.enum(CLOUDS)).max(CLOUDS.length),
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
  const who = await viewer();
  if (!who) return UNAUTHORIZED;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { id } = await params;
  const result = await updateRunConfig(id, who, parsed.data);
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

const DELETE_STATUS_FOR: Record<DeleteRunError, number> = {
  not_found: 404,
  // Provisioning is part-way through; the run is deletable again as soon as it
  // settles into ready or failed.
  in_flight: 409,
};

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const who = await viewer();
  if (!who) return UNAUTHORIZED;

  const { id } = await params;
  const result = await deleteRun(id, who);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: DELETE_STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ outcome: result.outcome });
}
