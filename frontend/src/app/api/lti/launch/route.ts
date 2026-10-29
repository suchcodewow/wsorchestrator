/**
 * TEMPORARY PROBE: delete with everything else docs/probes.md lists for it.
 *
 * LTI 1.3 launch (`lib/lti.ts`, steps 3 and 4). Mindtickle posts the signed
 * id_token here; it is verified and every claim is shown, logged and audited,
 * so we can see what Mindtickle sends before anything is built on it. It
 * signs nobody in. The raw token is never stored: the audit trail keeps only
 * the size of a form body.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { audited, noteAudit } from "@/lib/audit";
import { redact } from "@/lib/audit-shape";
import { ltiPlatform, verifyLaunch, LTI_LAUNCH_PATH, LTI_STATE_COOKIE_PREFIX } from "@/lib/lti";
import { launchPage, LTI_FRAME_ANCESTORS } from "@/lib/lti-page";

const STATE = /^[A-Za-z0-9_-]{32}$/;

function page(html: string, status: number, state: string | null): NextResponse {
  const res = new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors ${LTI_FRAME_ANCESTORS}`,
    },
  });
  // A nonce is good for one launch.
  if (state) {
    res.cookies.set(`${LTI_STATE_COOKIE_PREFIX}${state}`, "", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      partitioned: true,
      path: LTI_LAUNCH_PATH,
      maxAge: 0,
    });
  }
  return res;
}

export const POST = audited(async function POST(req) {
  const platform = ltiPlatform();
  if (!platform) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const form = await req.formData().catch(() => null);
  const field = (name: string) => {
    const v = form?.get(name);
    return typeof v === "string" && v ? v : null;
  };
  const rawState = field("state");
  const state = rawState && STATE.test(rawState) ? rawState : null;

  // The platform answers an authorization request it will not grant with an error instead of a token.
  const error = field("error");
  if (error) {
    noteAudit({ detail: { platformError: error, description: field("error_description") } });
    return page(launchPage(null, { error, description: field("error_description") }), 400, state);
  }

  const idToken = field("id_token");
  if (!idToken) return NextResponse.json({ error: "missing_id_token" }, { status: 400 });

  const nonce = state ? ((await cookies()).get(`${LTI_STATE_COOKIE_PREFIX}${state}`)?.value ?? null) : null;
  const result = await verifyLaunch(platform, idToken, nonce);
  const claims = result.claims ?? {};

  console.log(JSON.stringify({ lti_launch: { verified: result.verified, checks: result.checks, header: result.header, claims } }));
  // A forged token names whoever it likes, so only a signed one names the target.
  const signed = result.checks.some((c) => c.name === "signature" && c.ok);
  noteAudit({
    target: signed ? (typeof claims.email === "string" && claims.email) || claims.sub : undefined,
    targetLabel: signed && typeof claims.name === "string" ? claims.name : undefined,
    detail: { verified: result.verified, checks: result.checks, claims: redact(claims) },
  });

  return page(launchPage(result), result.verified ? 200 : 400, state);
});
