/**
 * The last step of a production import, called by the import job once the
 * restore is done (`runner/src/import-production.ts`).
 *
 * Nobody can be signed in at this point: the restore replaced the sessions
 * table, and the job emptied it. So, as with the scheduled HiBob sync, the
 * caller proves itself with a Google-signed OIDC token, and only one carrying
 * `PRODUCTION_IMPORT_AUDIENCE` for the `PRODUCTION_IMPORT_INVOKER` service
 * account (the runner's) is accepted. Either unset refuses every call, which
 * is how production refuses it.
 */

import { NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { auditBackupAction } from "@/lib/backups";
import {
  finishProductionImport,
  finishSchema,
  productionImportAvailable,
} from "@/lib/production-import";
import { audited } from "@/lib/audit";

// Every migration, then the clean-up. The job waits up to this long.
export const maxDuration = 300;

const google = new OAuth2Client();

async function fromImportJob(req: Request): Promise<boolean> {
  const audience = process.env.PRODUCTION_IMPORT_AUDIENCE;
  const invoker = process.env.PRODUCTION_IMPORT_INVOKER;
  if (!audience || !invoker) return false;

  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return false;

  try {
    const payload = (await google.verifyIdToken({ idToken: token, audience })).getPayload();
    return payload?.email === invoker && payload.email_verified === true;
  } catch {
    return false;
  }
}

export const POST = audited(async function POST(req: Request) {
  if (!productionImportAvailable() || !(await fromImportJob(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = finishSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const result = await finishProductionImport(parsed.data);
    auditBackupAction({
      action: "import_production_finished",
      actorId: "import-job",
      actorEmail: parsed.data.actor,
      backupId: parsed.data.backupId,
      result,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ severity: "ERROR", component: "production-import", message }),
    );
    return NextResponse.json({ error: "finish_failed", detail: message }, { status: 500 });
  }
});
