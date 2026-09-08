/** Downloads the contributor bundle. */

import { auth } from "@/auth";
import { mintBundleToken } from "@/lib/api-tokens";
import { NextResponse } from "next/server";
import { canContributeComponents } from "@/lib/roles";
import { buildBundle } from "@/lib/components/bundle";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canContributeComponents(session.user.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const credential = await mintBundleToken(session.user.id);
  if (!credential) {
    return NextResponse.json(
      { error: "token_failed", message: "Could not issue a token for the bundle." },
      { status: 500 },
    );
  }

  const { filename, archive } = await buildBundle({
    portalUrl: new URL(req.url).origin,
    token: credential.token,
    expiresAt: credential.expiresAt,
  });

  return new NextResponse(new Uint8Array(archive), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
