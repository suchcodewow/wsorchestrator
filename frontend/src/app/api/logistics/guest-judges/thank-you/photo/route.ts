/** One judge's round, ringed Slack photo, fetched by Google Slides from a signed link. */

import { NextResponse } from "next/server";
import { roundPhoto, verifyPhotoLink } from "@/lib/logistics/thank-you-photo";

export async function GET(req: Request) {
  const link = verifyPhotoLink(new URL(req.url).searchParams);
  if (!link) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const res = await fetch(link.src, { signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (!res.ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const png = await roundPhoto(Buffer.from(await res.arrayBuffer()), link.ring);
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=600" },
    });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
