/** Makes the thank-you slide of the guest judges' Slack photos in Google Slides. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { generateThankYou } from "@/lib/logistics/thank-you";
import { canManageTrainingSettings } from "@/lib/roles";

export const maxDuration = 120;

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  if (!user.email) {
    return NextResponse.json({ error: "no_email", message: "Your account has no email to share the slide with." }, { status: 409 });
  }
  noteAudit({ target: "guest-judges", targetLabel: "Guest judges thank-you slide" });
  const result = await generateThankYou(user.email);
  if (!result.ok) {
    const status = result.error === "failed" ? 502 : result.error === "no_judges" ? 404 : 409;
    return NextResponse.json({ error: result.error, message: result.message }, { status });
  }
  return NextResponse.json({ url: result.url, judges: result.judges, withPhotos: result.withPhotos }, { status: 201 });
});
