/**
 * Which images a draft body points at that the library no longer holds.
 *
 * Separate from `preview` because the Write tab has no preview to look at and
 * should not pay for one: this parses the body and runs a single lookup by id,
 * where a preview also highlights every code block.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { LAB_GUIDE_LIMITS } from "@/db/schema";
import { missingLabImages } from "@/lib/lab-images";
import { labImageRefs } from "@/lib/markdown";
import { canManageLabGuides } from "@/lib/roles";

const schema = z.object({
  body: z.string().max(LAB_GUIDE_LIMITS.body),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageLabGuides(session.user.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const refs = labImageRefs(parsed.data.body);
  const gone = new Set(await missingLabImages(refs.map((ref) => ref.id)));

  // The alt text goes back with the id: it is what the author wrote, and the
  // only part of a reference they will recognise.
  return NextResponse.json({
    missing: refs.filter((ref) => gone.has(ref.id)),
  });
}
