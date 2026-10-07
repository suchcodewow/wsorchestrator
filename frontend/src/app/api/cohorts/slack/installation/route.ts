/** The Slack app's install in the workspace, never its token; and forgetting it. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { canManageTrainingSettings } from "@/lib/roles";
import { envSlackToken } from "@/lib/slack";
import { deleteSlackInstallation, getSlackInstallation, slackApp } from "@/lib/slack-app";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const app = slackApp();
  return NextResponse.json({
    app: { configured: Boolean(app), appId: app?.appId ?? null },
    installation: await getSlackInstallation(),
    envToken: Boolean(envSlackToken()),
  });
}

export const DELETE = audited(async function DELETE(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const installation = await getSlackInstallation();
  if (!installation || !(await deleteSlackInstallation())) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  noteAudit({ target: installation.teamId, targetLabel: installation.teamName ?? undefined });
  return NextResponse.json({ ok: true });
});
