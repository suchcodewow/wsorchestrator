/**
 * Imports Mimir content from a JSON file: `{ items: [...] }`, parents before
 * what they hold. Sent as a file so the audit trail records its name and size
 * rather than the whole of it.
 */

import { NextResponse } from "next/server";
import { requireMimirAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { ITEM_STATUS_FOR, importItems, importSchema } from "@/lib/mimir/items";

/** Far past the Learning Hub's whole library, which is about 0.6 MB. */
const MAX_BYTES = 8 * 1024 * 1024;

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireMimirAdministrator(req);
  if (error) return error;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return NextResponse.json({ error: "not_json" }, { status: 400 });
  }
  const parsed = importSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: "invalid", path: issue?.path.join("."), message: issue?.message },
      { status: 400 },
    );
  }

  const result = await importItems(user.id, parsed.data.items);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, index: result.index, id: result.id },
      { status: ITEM_STATUS_FOR[result.error] },
    );
  }
  noteAudit({ detail: { created: result.created, updated: result.updated } });
  return NextResponse.json({ created: result.created, updated: result.updated });
});
