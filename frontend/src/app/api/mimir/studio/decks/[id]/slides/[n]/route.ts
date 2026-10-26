/** One slide's picture in a deck's draft, for checking it before it is published: a redirect to a signed link, as the map's own slides are. */

import { NextResponse } from "next/server";
import { requireMimirStudio } from "@/lib/api-auth";
import { objectSize, signedUrl } from "@/lib/recording/gcs";
import { parseSlideNumber } from "@/lib/mimir/map/slides";
import { bucket } from "@/lib/mimir/map/video";
import { getJob } from "@/lib/mimir/studio/jobs";
import { draftSlidePrefix } from "@/lib/mimir/studio/shapes";

type Params = { params: Promise<{ id: string; n: string }> };

const URL_SECONDS = 60 * 60;

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireMimirStudio(req);
  if (error) return error;

  const { id, n: raw } = await params;
  const n = parseSlideNumber(raw);
  const job = await getJob(id);
  if (n === null || !job || job.kind !== "deck") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const b = bucket();
  if (!b) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const object = `${draftSlidePrefix(job.id)}${n}.jpg`;
  if ((await objectSize(b, object)) === null) return NextResponse.json({ error: "missing" }, { status: 404 });

  const url = await signedUrl({ method: "GET", bucket: b, object, expiresSeconds: URL_SECONDS });
  return new NextResponse(null, { status: 302, headers: { Location: url, "Cache-Control": `private, max-age=${URL_SECONDS - 600}` } });
}
