/** One version of the concept map's structure, without videos: what the Map Editor opens, or what a restore would put back. */

import { NextResponse } from "next/server";
import { requireMimirAdministrator } from "@/lib/api-auth";
import { getMapVersion } from "@/lib/mimir/map/content";

export async function GET(req: Request, { params }: { params: Promise<{ version: string }> }) {
  const { error } = await requireMimirAdministrator(req);
  if (error) return error;

  const raw = (await params).version;
  const found = /^[1-9][0-9]{0,8}$/.test(raw) ? await getMapVersion(Number(raw)) : null;
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    version: Number(raw),
    source: found.source,
    createdAt: found.createdAt.toISOString(),
    content: found.content,
  });
}
