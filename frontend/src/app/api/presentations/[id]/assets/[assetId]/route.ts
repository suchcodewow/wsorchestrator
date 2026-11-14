/** Serves one of a presentation's pictures: a converted slide's background, or an element cut from it. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { getAsset } from "@/lib/presentations/presentations";
import { canUseTraining } from "@/lib/roles";

type Params = { params: Promise<{ id: string; assetId: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const { id, assetId } = await params;
  const image = await getAsset(id, assetId);
  if (!image) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // A picture is never changed once made; a new conversion makes new ones.
  return new Response(new Uint8Array(image), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
