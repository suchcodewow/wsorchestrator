/** The component review queue. */

import { NextResponse } from "next/server";
import { sessionOrToken } from "@/lib/api-auth";
import { canContributeComponents, canPublishComponents } from "@/lib/roles";
import { createComponentSet, listComponentSets } from "@/lib/components/catalog";
import { validateSet } from "@/lib/components/validate";
import { createScheduledRun } from "@/lib/runs";
import { startRunNow } from "@/lib/trigger";
import type { ComponentSetStatus } from "@/db/schema";

const SANDBOX_TTL_SECONDS = 2 * 60 * 60;

export async function GET(req: Request) {
  const viewer = await sessionOrToken(req);
  if (!viewer) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canContributeComponents(viewer.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const status = new URL(req.url).searchParams.get("status");
  const sets = await listComponentSets(
    (status as ComponentSetStatus | null) ?? undefined,
  );

  const mine = canPublishComponents(viewer.siteRole)
    ? sets
    : sets.filter((s) => s.authorId === viewer.id);

  return NextResponse.json({ sets: mine });
}

export async function POST(req: Request) {
  const viewer = await sessionOrToken(req);
  if (!viewer) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canContributeComponents(viewer.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    components?: unknown;
    test?: unknown;
  } | null;

  if (!body || typeof body.name !== "string" || body.name.trim().length === 0) {
    return NextResponse.json(
      { error: "invalid_body", message: "a set needs a name" },
      { status: 400 },
    );
  }

  const { issues, valid } = validateSet(body.components);
  if (issues.length > 0) {
    return NextResponse.json({ error: "invalid_components", issues }, { status: 422 });
  }

  const name = body.name.trim().slice(0, 200);
  const { id: setId } = await createComponentSet({
    name,
    authorId: viewer.id,
    components: valid,
  });

  if (body.test === false) {
    return NextResponse.json({ setId, run: null, started: false }, { status: 201 });
  }

  const { run } = await createScheduledRun({
    name: `Sandbox — ${name}`,
    mode: "workshop",
    userCount: 1,
    clouds: [],
    userId: viewer.id,
    scheduledStart: new Date(),
    ttlSeconds: SANDBOX_TTL_SECONDS,
    startNow: true,
    harnessOnly: true,
    componentSetId: setId,
  });

  const started = await startRunNow(run.id);

  return NextResponse.json({ setId, run, started }, { status: 201 });
}
