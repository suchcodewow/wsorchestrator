/**
 * Files a stream of a take before its chunks are uploaded; the browser says
 * so again after a reload. The answer says how to upload: straight to the
 * bucket on signed URLs, or through the chunk route.
 */

import { after, NextResponse } from "next/server";
import { SYSTEM_ACTORS, audited, noteAudit, recordAudit } from "@/lib/audit";
import { purgeExpiredTakes, registerTrack, registerTrackSchema, uploadMode } from "@/lib/recording/recordings";
import { RECORDING_RETENTION_DAYS } from "@/lib/recording/video";

/** Deletes recordings past their retention, each recorded as the app's own doing. */
async function purge() {
  for (const { takeId, contributor } of await purgeExpiredTakes()) {
    await recordAudit({
      actor: null,
      actorName: SYSTEM_ACTORS.system,
      via: "system",
      action: "recordings.expire",
      summary: `Deleted a recording ${RECORDING_RETENTION_DAYS} days after it was made.`,
      target: takeId,
      targetLabel: contributor ? `recording by ${contributor}` : "recording",
      outcome: "succeeded",
    });
  }
}

export const POST = audited(async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = registerTrackSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const track = await registerTrack(id, parsed.data);
  if (!track) return NextResponse.json({ error: "not_found" }, { status: 404 });
  noteAudit({ target: track.id, targetLabel: `${track.kind} of take ${track.takeId}` });
  // Keeping to the retention window rides on new recordings arriving, so it needs no scheduler.
  after(() => purge().catch((err) => console.error("recording: purge failed", err)));
  return NextResponse.json({ ...track, upload: uploadMode() });
});
