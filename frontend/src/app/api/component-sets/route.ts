import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canContributeComponents, canPublishComponents } from "@/lib/roles";
import { createComponentSet, listComponentSets } from "@/lib/components/catalog";
import { validateSet } from "@/lib/components/validate";
import { createScheduledRun } from "@/lib/runs";
import { startRunNow } from "@/lib/trigger";
import type { ComponentSetStatus } from "@/db/schema";

/**
 * How long a sandbox run lives before the reaper takes it.
 *
 * Two hours, not the one-day default an event gets. A sandbox holds a Harness
 * organization and nothing else, but it is started by the one role that may
 * belong to somebody outside the team, and it is meant to be re-run rather than
 * kept — a contributor who needs longer starts another, which costs nothing
 * because no cloud is involved.
 */
const SANDBOX_TTL_SECONDS = 2 * 60 * 60;

/** Review queue. Managers see every set; a contributor sees their own. */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canContributeComponents(session.user.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const status = new URL(req.url).searchParams.get("status");
  const sets = await listComponentSets(
    (status as ComponentSetStatus | null) ?? undefined,
  );

  const mine = canPublishComponents(session.user.siteRole)
    ? sets
    : sets.filter((s) => s.authorId === session.user.id);

  return NextResponse.json({ sets: mine });
}

/**
 * Create a candidate set and, unless asked not to, start the sandbox run that
 * tests it.
 *
 * This is the step that puts a contribution in the database, and it is
 * deliberately the *testing* step rather than a separate submit. There is no
 * import endpoint and no upload of a reviewed artifact, so what a reviewer
 * looks at is necessarily what was tested — the usual gap between the two
 * cannot open.
 *
 * The plain-bundle path posts here too, with `test: false`. Someone who worked
 * without ever running a sandbox can still offer their components; the set is
 * simply created with no run against it, which the review queue shows.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canContributeComponents(session.user.siteRole)) {
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
    // 422 rather than 400: the request was well-formed and understood, and the
    // components in it are what did not pass. The distinction matters to the
    // bundle's script, which prints issues for one and a transport error for
    // the other.
    return NextResponse.json({ error: "invalid_components", issues }, { status: 422 });
  }

  const name = body.name.trim().slice(0, 200);
  const { id: setId } = await createComponentSet({
    name,
    authorId: session.user.id,
    components: valid,
  });

  if (body.test === false) {
    return NextResponse.json({ setId, run: null, started: false }, { status: 201 });
  }

  // A Harness-only run: the org, the catalog with this set overlaid, and a
  // project for the contributor to build a pipeline in. No Terraform, no
  // Workspace accounts, no cloud.
  const { run } = await createScheduledRun({
    name: `Sandbox — ${name}`,
    mode: "workshop",
    // One project, for whoever is testing. The roster is not used by a
    // Harness-only run; this is what the run page counts.
    userCount: 1,
    clouds: [],
    userId: session.user.id,
    scheduledStart: new Date(),
    ttlSeconds: SANDBOX_TTL_SECONDS,
    startNow: true,
    harnessOnly: true,
    componentSetId: setId,
  });

  const started = await startRunNow(run.id);

  return NextResponse.json({ setId, run, started }, { status: 201 });
}
