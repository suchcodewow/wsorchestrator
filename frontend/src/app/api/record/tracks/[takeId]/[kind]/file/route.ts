/**
 * One finished stream of the caller's own take, to download: what the
 * recorder page offers once an upload is complete, so whoever recorded it
 * keeps a copy. Anyone else's take is not found.
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { findTrack } from "@/lib/recording/recordings";
import { serveTrackFile } from "@/lib/recording/serve-file";

export async function GET(req: Request, { params }: { params: Promise<{ takeId: string; kind: string }> }) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const { takeId, kind } = await params;
  if (!(await findTrack(user.id, takeId, kind))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return serveTrackFile(req, takeId, kind, true);
}
