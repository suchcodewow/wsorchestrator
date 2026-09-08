/** Restores the database from a backup. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  auditBackupAction,
  listBackups,
  restoreBackup,
  runsStrandedBy,
  type RestoreError,
} from "@/lib/backups";
import { canManageBackups } from "@/lib/roles";

const restoreSchema = z.object({
  confirmation: z.string().min(1),
});

const STATUS_FOR: Record<RestoreError, number> = {
  not_configured: 503,
  permission_denied: 502,
  unavailable: 502,
  not_found: 404,
  not_restorable: 409,
  confirmation_mismatch: 400,
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageBackups(session.user.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = restoreSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { id } = await params;

  const listed = await listBackups();
  const backup = listed.ok ? listed.backups.find((b) => b.id === id) : undefined;
  const stranded = backup?.startTime
    ? await runsStrandedBy(new Date(backup.startTime))
    : [];

  auditBackupAction({
    action: "restore",
    actorId: session.user.id,
    actorEmail: session.user.email ?? "",
    backupId: id,
    backupTime: backup?.startTime ?? null,
    strandedRunIds: stranded.map((r) => r.id),
  });

  const result = await restoreBackup(id, parsed.data.confirmation);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }

  return NextResponse.json(
    { ok: true, stranded: stranded.map((r) => ({ id: r.id, name: r.name })) },
    { status: 202 },
  );
}
