import { auth } from "@/auth";
import { mintBundleToken } from "@/lib/api-tokens";
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
 *
 * The download carries its own credential, written into a `.env` beside the
 * scripts, so there is nothing to create and nothing to export. Each download
 * revokes the previous one, so a bundle left on an old laptop stops working
 * rather than accumulating live tokens in Downloads folders.
 *
 * Session-only, unlike the other component endpoints, and that is a direct
 * consequence of the above: this route now mints a token, and a token that can
 * mint another renews itself past any expiry and survives revoking the one that
 * leaked. Nothing in the bundle downloads the bundle, so requiring a browser
 * costs nobody anything.
 */
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

  // The portal's own address as the browser reached it, so a bundle downloaded
  // from a preview deployment points back at that one rather than at whatever
  // is baked into the container's configuration.
  const { filename, archive } = await buildBundle({
    portalUrl: new URL(req.url).origin,
    token: credential.token,
    expiresAt: credential.expiresAt,
  });

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
