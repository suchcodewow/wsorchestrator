/**
 * Imports the concept map from a JSON file (see `mapContentSchema`), replacing
 * the one there. Sent as a file so the audit trail records its name and size
 * rather than the whole of it.
 */

import { NextResponse } from "next/server";
import { requireMimirAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { importMap } from "@/lib/mimir/map/content";
import { mapContentSchema } from "@/lib/mimir/map/schema";

/** Far past the map and the narration of every video in it. */
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
  const parsed = mapContentSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: "invalid", path: issue?.path.join("."), message: issue?.message }, { status: 400 });
  }

  await importMap(user.id, parsed.data);
  const videos = parsed.data.concepts.filter((c) => c.video).length;
  noteAudit({ detail: { file: file.name, bytes: file.size, concepts: parsed.data.concepts.length, videos } });
  return NextResponse.json({ ok: true, concepts: parsed.data.concepts.length, videos });
});
