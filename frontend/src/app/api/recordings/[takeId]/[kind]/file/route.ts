/** One finished stream of a take, for a Training Administrator: the camera or the screen, as a file. */

import { requireCaller } from "@/lib/api-auth";
import { serveTrackFile } from "@/lib/recording/serve-file";
import { canManageTrainingSettings } from "@/lib/roles";

export async function GET(req: Request, { params }: { params: Promise<{ takeId: string; kind: string }> }) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const { takeId, kind } = await params;
  return serveTrackFile(req, takeId, kind, new URL(req.url).searchParams.get("download") === "1");
}
