import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessionOrToken } from "@/lib/api-auth";
import { harnessComponentSets } from "@/db/schema";
import { canContributeComponents, canPublishComponents } from "@/lib/roles";
import {
  listSetComponents,
  replaceSetComponents,
  setStatus,
} from "@/lib/components/catalog";
import { validateSet } from "@/lib/components/validate";

/** The set, if the caller may see it: its author, or any manager. */
async function readable(setId: string, userId: string, role: string) {
  const [set] = await db
    .select()
    .from(harnessComponentSets)
    .where(eq(harnessComponentSets.id, setId));

  if (!set) return null;
  if (canPublishComponents(role as never)) return set;
  return set.authorId === userId ? set : null;
}

/** One candidate set and the components it proposes. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await sessionOrToken(req);
  if (!viewer) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const set = await readable(id, viewer.id, viewer.siteRole);
  // A set somebody else owns answers the same "not found" as one that never
  // existed, so the endpoint does not confirm which ids are real.
  if (!set) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ set, components: await listSetComponents(id) });
}

/**
 * Replace what a set proposes — the contributor iterating after a sandbox run
 * showed them something.
 *
 * Only while it is still `testing`. Rewriting a submitted set would change what
 * a reviewer is reading underneath them; rewriting an approved one would put it
 * silently out of step with the baseline it was folded into.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await sessionOrToken(req);
  if (!viewer) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canContributeComponents(viewer.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const set = await readable(id, viewer.id, viewer.siteRole);
  if (!set) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    components?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { issues, valid } = validateSet(body.components);
  if (issues.length > 0) {
    return NextResponse.json({ error: "invalid_components", issues }, { status: 422 });
  }

  const replaced = await replaceSetComponents(id, valid);
  if (!replaced) {
    return NextResponse.json(
      {
        error: "not_editable",
        message: `a set is only editable while it is testing (this one is ${set.status})`,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ setId: id, components: valid.length });
}

/**
 * Withdraw a submission, putting it back to `testing` so it can be worked on.
 *
 * A delete would be the obvious verb, but the set is what a sandbox run
 * deployed and what its logs refer to; removing it would cascade those
 * components out from under a run still standing.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await sessionOrToken(req);
  if (!viewer) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const set = await readable(id, viewer.id, viewer.siteRole);
  if (!set) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const moved = await setStatus(id, "submitted", "testing");
  if (!moved) {
    return NextResponse.json(
      {
        error: "not_withdrawable",
        message: `only a submitted set can be withdrawn (this one is ${set.status})`,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ setId: id, status: "testing" });
}
