/**
 * Replaces this deployment's database with one of production's backups. QA
 * only; see `lib/production-import.ts`.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { auditBackupAction } from "@/lib/backups";
import {
  productionImportAvailable,
  startProductionImport,
  type ImportError,
} from "@/lib/production-import";
import { canManageBackups } from "@/lib/roles";

const importSchema = z.object({
  confirmation: z.string().min(1),
});

const STATUS_FOR: Record<ImportError, number> = {
  not_configured: 503,
  permission_denied: 502,
  unavailable: 502,
  not_found: 404,
  not_restorable: 409,
  confirmation_mismatch: 400,
  runs_hold_resources: 409,
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageBackups(session.user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!productionImportAvailable()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = importSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { id } = await params;
  const result = await startProductionImport({
    backupId: id,
    confirmation: parsed.data.confirmation,
    actorEmail: session.user.email ?? session.user.id,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, holding: result.holding },
      { status: STATUS_FOR[result.error] },
    );
  }

  auditBackupAction({
    action: "import_production",
    actorId: session.user.id,
    actorEmail: session.user.email ?? "",
    backupId: id,
    execution: result.execution,
  });

  return NextResponse.json({ ok: true, execution: result.execution }, { status: 202 });
}
