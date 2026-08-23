import { sessionOrToken } from "@/lib/api-auth";
import { NextResponse } from "next/server";
import { canContributeComponents } from "@/lib/roles";
import { buildBundle } from "@/lib/components/bundle";

/**
 * Download the contributor bundle: a Claude Code skill built from the live
 * catalog.
 *
 * Generated per request rather than served from disk, because the part that
 * matters most is the list of components that already exist — the part a static
 * file gets wrong first. What a contributor unzips is the baseline as it stands
 * at that moment, so Claude references the connector that is really there
 * instead of inventing a plausible identifier for it.
 */
export async function GET(req: Request) {
  const viewer = await sessionOrToken(req);
  if (!viewer) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canContributeComponents(viewer.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { filename, archive } = await buildBundle();

  return new NextResponse(new Uint8Array(archive), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      // The catalog changes when a set is approved, and a stale bundle is the
      // one failure mode generating it per request exists to avoid.
      "cache-control": "no-store",
    },
  });
}
