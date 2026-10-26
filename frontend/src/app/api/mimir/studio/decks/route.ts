/**
 * Starts a new slide deck's reading: makes its job and answers with a signed
 * link to PUT the file to, so the deck goes from the browser to the bucket
 * and never through the app. `decks/{id}/start` sets it going once it is up.
 */

import { NextResponse } from "next/server";
import { requireMimirStudio } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { signedUrl } from "@/lib/recording/gcs";
import { bucket } from "@/lib/mimir/map/video";
import { createDeckJob } from "@/lib/mimir/studio/jobs";
import { deckInputSchema, deckObject } from "@/lib/mimir/studio/shapes";
import { studioConfigured } from "@/lib/mimir/studio/trigger";

const UPLOAD_URL_SECONDS = 60 * 60;

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireMimirStudio(req);
  if (error) return error;

  const parsed = deckInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (!/\.pptx$/i.test(parsed.data.fileName)) return NextResponse.json({ error: "not_pptx" }, { status: 400 });
  const b = bucket();
  if (!b || !studioConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const job = await createDeckJob(user.id, parsed.data);
  if (job === "busy") return NextResponse.json({ error: "busy" }, { status: 409 });
  const uploadUrl = await signedUrl({ method: "PUT", bucket: b, object: deckObject(job.id), expiresSeconds: UPLOAD_URL_SECONDS });
  noteAudit({ target: job.id, targetLabel: job.label, detail: { bytes: parsed.data.bytes } });
  return NextResponse.json({ job, uploadUrl }, { status: 201 });
});
