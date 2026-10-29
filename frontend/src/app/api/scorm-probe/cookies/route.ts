/**
 * TEMPORARY PROBE: delete with everything else docs/probes.md lists for it.
 *
 * Says which of the probe's three cookies arrived, then sets all three again,
 * so `/scorm-probe` calls it twice and the second answer is what survives in
 * the frame: a `Lax` cookie, a `None` one, and a `None; Partitioned` one,
 * each `Secure`, so only SameSite and partitioning differ.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SCORM_PROBE_COOKIE_MAX_AGE, SCORM_PROBE_COOKIE_PATH, SCORM_PROBE_COOKIES } from "@/lib/scorm-probe";

export async function GET() {
  const jar = await cookies();
  const arrived = {
    lax: jar.has(SCORM_PROBE_COOKIES.lax),
    none: jar.has(SCORM_PROBE_COOKIES.none),
    partitioned: jar.has(SCORM_PROBE_COOKIES.partitioned),
  };

  const res = NextResponse.json({ arrived }, { headers: { "Cache-Control": "no-store" } });
  const common = { httpOnly: true, secure: true, path: SCORM_PROBE_COOKIE_PATH, maxAge: SCORM_PROBE_COOKIE_MAX_AGE };
  res.cookies.set(SCORM_PROBE_COOKIES.lax, "1", { ...common, sameSite: "lax" });
  res.cookies.set(SCORM_PROBE_COOKIES.none, "1", { ...common, sameSite: "none" });
  res.cookies.set(SCORM_PROBE_COOKIES.partitioned, "1", { ...common, sameSite: "none", partitioned: true });
  return res;
}
