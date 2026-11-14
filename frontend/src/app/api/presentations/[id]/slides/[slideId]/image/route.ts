/** Serves one slide's picture, fetching it from Google the first time it is asked for. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { PRESENTATION_STATUS } from "@/lib/presentations/input";
import { slideImage } from "@/lib/presentations/presentations";
import { canUseTraining } from "@/lib/roles";

type Params = { params: Promise<{ id: string; slideId: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const { id, slideId } = await params;
  const result = await slideImage(id, slideId);
  if (!result.ok) {
    const message = "message" in result ? result.message : undefined;
    return NextResponse.json({ error: result.error, message }, { status: PRESENTATION_STATUS[result.error] });
  }
  // The page asks with ?v=<version>, which changes with the slide, so a current picture can be kept for good.
  const versioned = new URL(req.url).searchParams.has("v");
  return new Response(new Uint8Array(result.image), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": versioned && result.current ? "private, max-age=31536000, immutable" : "private, no-cache",
    },
  });
}
