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
  /** The instance name, typed by hand. Re-checked in `restoreBackup`. */
  confirmation: z.string().min(1),
});

const STATUS_FOR: Record<RestoreError, number> = {
  not_configured: 503,
  permission_denied: 502,
  unavailable: 502,
  not_found: 404,
  // The backup exists but never completed; restoring it is not a thing to do.
  not_restorable: 409,
  confirmation_mismatch: 400,
};

/**
 * Restore the database in place from a backup. Administrators only.
 *
 * This is the most destructive endpoint in the app. Everything guarding it:
 *
 *   * administrator role, checked here;
 *   * the instance name typed back, checked again in `@/lib/backups`;
 *   * the backup must have completed successfully;
 *   * the runs it will strand are recorded to Cloud Logging *before* the call,
 *     because the database that would otherwise hold that record is about to
 *     be rolled back.
 *
 * The response is likely the last thing this deployment returns for a few
 * minutes — the instance goes offline for the restore, taking the app's own
 * sessions with it.
 */
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

  // Read the runs at risk while the database still knows about them.
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

  // 202: Cloud SQL has accepted the operation, not finished it.
  return NextResponse.json(
    { ok: true, stranded: stranded.map((r) => ({ id: r.id, name: r.name })) },
    { status: 202 },
  );
}
