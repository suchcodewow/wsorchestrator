import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { LAB_GUIDE_LIMITS } from "@/db/schema";
import { renderMarkdown } from "@/lib/markdown";
import { canManageLabGuides } from "@/lib/roles";

const previewSchema = z.object({
  body: z.string().max(LAB_GUIDE_LIMITS.body),
});

/**
 * Render a draft body without saving it.
 *
 * A round trip rather than a markdown parser in the editor's bundle, and that
 * is the point: the preview comes out of the same pipeline as the published
 * page, so what an author sees while writing is what the room will see. A
 * second implementation on the client would be a second set of rules to drift.
 *
 * Manager-gated like the writes it previews — it renders nothing that isn't
 * already in the request, but it is not a service to hand to anonymous callers.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageLabGuides(session.user.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = previewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // With source lines, so the split view can scroll the rendering to whatever
  // is being typed. They cost a `data-line` per block and are ignored by an
  // editor that does not want them.
  const { html } = await renderMarkdown(parsed.data.body, {
    sourceLines: true,
  });
  return NextResponse.json({ html });
}
