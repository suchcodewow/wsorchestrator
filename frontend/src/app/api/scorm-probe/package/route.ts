/**
 * TEMPORARY PROBE: delete with everything else docs/probes.md lists for it.
 *
 * The SCORM package (`lib/scorm-probe.ts`) to upload to Mindtickle, framing
 * this environment's `/scorm-probe`. Public: it holds nothing but the app's
 * own address.
 */

import { appBase } from "@/lib/oauth-callback";
import { scormPackage } from "@/lib/scorm-probe";

export function GET(req: Request) {
  const base = appBase(req);
  const host = new URL(base).hostname.replace(/[^a-z0-9.-]/gi, "");

  return new Response(new Uint8Array(scormPackage(base)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="scorm-probe-${host}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
