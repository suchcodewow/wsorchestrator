/** Every email address on the Current tab for a stage, track, RSVP filter and search: what the tab's copy button copies. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { isCandidateStage, isCurrentTrack, listCurrentCohortEmails } from "@/lib/evals/current-cohort";
import { canUseTraining } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const stage = params.get("stage");
  if (stage !== null && !isCandidateStage(stage)) return NextResponse.json({ error: "invalid_stage" }, { status: 400 });
  const track = params.get("track");
  if (track !== null && !isCurrentTrack(track)) return NextResponse.json({ error: "invalid_track" }, { status: 400 });
  const rsvp = params.get("rsvp");
  if (rsvp !== null && rsvp !== "none") return NextResponse.json({ error: "invalid_rsvp" }, { status: 400 });

  const emails = await listCurrentCohortEmails({ stage, track, unanswered: rsvp === "none" }, params.get("q")?.trim() ?? "");
  return NextResponse.json({ stage, track, rsvp, emails });
}
