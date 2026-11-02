/**
 * The concept map's versions: the history, a page at a time, and a change to
 * the live map made in Mimir Settings → Map Editor. A change names the version
 * it was made from and is refused if another has been added since, so it never
 * overwrites one it did not see. Either it edits the structure or it puts an
 * earlier version back; the videos stay as they are.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMimirAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { MAP_VERSION_LIST } from "@/lib/list-specs";
import { editMap, getMapVersion, listMapVersions } from "@/lib/mimir/map/content";
import { MAP_SUMMARY_MAX, mapContentSchema, withoutVideos } from "@/lib/mimir/map/schema";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error } = await requireMimirAdministrator(req);
  if (error) return error;

  const { rows, page, hasMore } = await listMapVersions(parseListQuery(new URL(req.url).searchParams, MAP_VERSION_LIST));
  return NextResponse.json({ versions: rows, page, hasMore });
}

const bodySchema = z.union([
  z.object({ base: z.number().int().min(1), content: z.unknown(), summary: z.string().trim().min(1).max(MAP_SUMMARY_MAX) }),
  z.object({ base: z.number().int().min(1), restore: z.number().int().min(1) }),
]);

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireMimirAdministrator(req);
  if (error) return error;

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  let content;
  let summary: string;
  if ("restore" in body.data) {
    const earlier = await getMapVersion(body.data.restore);
    if (!earlier) return NextResponse.json({ error: "not_found" }, { status: 404 });
    content = earlier.content;
    summary = `Restored version ${body.data.restore}.`;
  } else {
    const parsed = mapContentSchema.safeParse(body.data.content);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json({ error: "invalid", path: issue?.path.join("."), message: issue?.message }, { status: 400 });
    }
    content = withoutVideos(parsed.data);
    summary = body.data.summary;
  }

  const outcome = await editMap(user.id, body.data.base, content, summary, "restore" in body.data ? "restore" : "edit");
  if (!outcome.ok) {
    noteAudit({ detail: { base: body.data.base, live: outcome.live } });
    return NextResponse.json({ error: "conflict", live: outcome.live }, { status: 409 });
  }
  noteAudit({ target: `v${outcome.version}`, targetLabel: `Map version ${outcome.version}`, detail: { base: body.data.base, summary } });
  return NextResponse.json({ version: outcome.version }, { status: 201 });
});
