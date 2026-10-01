/** Renders a draft guide body without saving it. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionOrToken } from "@/lib/api-auth";
import { LAB_GUIDE_LIMITS } from "@/db/schema";
import { missingLabImages } from "@/lib/lab-images";
import { labImageRefs, renderMarkdown } from "@/lib/markdown";
import { canManageLabGuides } from "@/lib/roles";

const previewSchema = z.object({
  body: z.string().max(LAB_GUIDE_LIMITS.body),
});

export async function POST(req: Request) {
  const caller = await sessionOrToken(req);
  if (!caller) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageLabGuides(caller.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = previewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const refs = labImageRefs(parsed.data.body);
  const missing = await missingLabImages(refs.map((ref) => ref.id));

  // No values: an author sees `{{project}}` where a reader will see their own
  // project, which is what makes the blanks visible while writing.
  const { html, variables } = await renderMarkdown(parsed.data.body, {
    sourceLines: true,
    missingImages: missing,
  });
  return NextResponse.json({ html, variables });
}
