/**
 * One slide's picture, for the map's hover preview. `GET` redirects to a
 * short-lived signed Cloud Storage link, so the image goes from the bucket to
 * the browser and never through the app. The redirect is cached for most of
 * the link's life, so hovering the same slide again asks nothing.
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import {
  SLIDE_CACHE_SECONDS,
  parseSlideNumber,
  signedSlideUrl,
} from "@/lib/mimir/map/slides";

type Params = { params: Promise<{ n: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireUser(req);
  if (error) return error;

  const n = parseSlideNumber((await params).n);
  if (n === null)
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const signed = await signedSlideUrl(n);
  if (!signed.ok)
    return NextResponse.json(
      { error: signed.error },
      { status: signed.error === "missing" ? 404 : 503 },
    );

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: signed.url,
      "Cache-Control": `private, max-age=${SLIDE_CACHE_SECONDS}`,
    },
  });
}
