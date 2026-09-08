/** Renders a stored guide for the workshop editor's preview. */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLabGuideById } from "@/lib/lab-guides";
import { renderMarkdown } from "@/lib/markdown";
import { canManageLabGuides } from "@/lib/roles";

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
