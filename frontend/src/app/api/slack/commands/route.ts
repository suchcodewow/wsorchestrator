/**
 * Slack's slash commands. `/val` lists the upcoming bootcamps, as the Welcome
 * page does, in a reply only the person who asked sees.
 *
 * Slack sends a form post signed with the app's Signing Secret
 * (`SLACK_SIGNING_SECRET`); anything unsigned is refused. It changes nothing,
 * so it is not audited.
 */

import { NextResponse } from "next/server";
import { slackSignatureValid, upcomingMessage } from "@/lib/slack-command";
import { upcomingBootcamps } from "@/lib/scheduler/bootcamps";

const reply = (text: string) => NextResponse.json({ response_type: "ephemeral", text });

export async function POST(req: Request) {
  // The signature covers the raw body, so read it as text before parsing.
  const raw = await req.text();
  const signed = slackSignatureValid(
    process.env.SLACK_SIGNING_SECRET,
    raw,
    req.headers.get("x-slack-request-timestamp"),
    req.headers.get("x-slack-signature"),
  );
  if (!signed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const command = new URLSearchParams(raw).get("command");
  if (command === "/val") return reply(upcomingMessage(await upcomingBootcamps()));
  return reply("Try /val.");
}
