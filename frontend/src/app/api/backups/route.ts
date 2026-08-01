import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { auditBackupAction, createBackup, listBackups } from "@/lib/backups";
import { canManageBackups } from "@/lib/roles";

/** Signed in, and allowed to see the database's backups. */
async function requireAdministrator() {
  const session = await auth();
  if (!session?.user) {
    return {
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      user: null,
    };
  }
  if (!canManageBackups(session.user.siteRole)) {
    return {
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
      user: null,
    };
  }
  return { error: null, user: session.user };
}

const STATUS_FOR: Record<string, number> = {
  not_configured: 503,
  permission_denied: 502,
  unavailable: 502,
};

/** The backup history. Administrators only. */
export async function GET() {
  const { error } = await requireAdministrator();
  if (error) return error;

  const result = await listBackups();
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] ?? 502 },
    );
  }

  return NextResponse.json({ backups: result.backups });
}

const createSchema = z.object({
  description: z.string().trim().max(255).default(""),
});

/**
 * Take a backup now. Administrators only.
 *
 * The safe half of this page, and the one to press before the other half.
 */
export async function POST(req: Request) {
  const { error, user } = await requireAdministrator();
  if (error) return error;

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const description =
    parsed.data.description || `On demand — ${user.email ?? user.id}`;

  const result = await createBackup(description);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] ?? 502 },
    );
  }

  auditBackupAction({
    action: "backup",
    actorId: user.id,
    actorEmail: user.email ?? "",
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
