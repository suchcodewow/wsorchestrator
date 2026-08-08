import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLabGuideById } from "@/lib/lab-guides";
import { renderMarkdown } from "@/lib/markdown";
import { canManageLabGuides } from "@/lib/roles";

/**
 * Render a stored guide, by id, for the preview dialog in the workshop editor.
 *
 * The sibling `POST /api/lab-guides/preview` renders a body the caller already
 * has — it serves the guide editor, which is holding unsaved text. This one
 * fetches the body itself, because the workshop editor deliberately never loads
 * them: a workshop can hold fifty guides, each up to 200 KB of Markdown, and
 * shipping all of that into the page to power a dialog nobody may open is a
 * trade worth refusing. One request, on the click that needs it.
 *
 * Manager-gated to match the editor it serves.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageLabGuides(session.user.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const guide = await getLabGuideById(id);
  if (!guide) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { html } = await renderMarkdown(guide.body);

  return NextResponse.json({
    slug: guide.slug,
    title: guide.title,
    summary: guide.summary,
    html,
  });
}
