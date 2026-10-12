/** Bringing a Google Form's responses sheet into one intake form: a look first, then the import. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { importIntakeResponses, type IntakeImportError } from "@/lib/logistics/intake-import";
import { INTAKE_FORM_LABELS, isIntakeFormId } from "@/lib/logistics/intake-values";
import { canManageTrainingSettings } from "@/lib/roles";

const STATUS_FOR: Record<IntakeImportError, number> = {
  no_file: 400,
  too_large: 413,
  unreadable: 400,
  empty: 400,
  no_email_column: 400,
  too_many_rows: 413,
};

export const POST = audited(async function POST(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const form = params.get("form");
  if (!isIntakeFormId(form)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.formData().catch(() => null);
  const file = body?.get("file");
  const commit = params.get("commit") === "1";

  noteAudit({ target: `intake-form:${form}`, targetLabel: `${INTAKE_FORM_LABELS[form]} responses${commit ? "" : " (preview)"}` });
  const result = await importIntakeResponses(form, file instanceof File ? file : null, commit);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS_FOR[result.error] });
  return NextResponse.json(result.summary);
});
