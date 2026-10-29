/**
 * LTI 1.3 third-party initiated login (`lib/lti.ts`, step 1 to 2). Mindtickle
 * sends the browser here, by GET or by a form POST, and it is sent straight
 * on to Mindtickle's authorization endpoint with a state and nonce, which
 * post a signed launch back to `/api/lti/launch`. Public: the launch's
 * signature is what anyone must get past, not this.
 */

import { NextResponse } from "next/server";
import { audited, noteAudit } from "@/lib/audit";
import {
  authorizeUrl,
  loginProblem,
  ltiPlatform,
  newLoginState,
  LTI_LAUNCH_PATH,
  LTI_STATE_COOKIE_PREFIX,
  LTI_STATE_MAX_AGE,
  type LoginParams,
} from "@/lib/lti";
import { appBase } from "@/lib/oauth-callback";

function start(req: Request, params: LoginParams): NextResponse {
  const platform = ltiPlatform();
  if (!platform) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  noteAudit({
    target: params.login_hint,
    detail: { iss: params.iss ?? null, clientId: params.client_id ?? null, deploymentId: params.lti_deployment_id ?? null },
  });
  const problem = loginProblem(platform, params);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const login = newLoginState();
  const res = NextResponse.redirect(authorizeUrl(platform, params, `${appBase(req)}${LTI_LAUNCH_PATH}`, login), 302);
  res.cookies.set(`${LTI_STATE_COOKIE_PREFIX}${login.state}`, login.nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    partitioned: true,
    path: LTI_LAUNCH_PATH,
    maxAge: LTI_STATE_MAX_AGE,
  });
  return res;
}

function paramsOf(entries: Iterable<[string, FormDataEntryValue]>): LoginParams {
  const out: Record<string, string> = {};
  for (const [k, v] of entries) if (typeof v === "string") out[k] = v;
  return out;
}

export async function GET(req: Request) {
  return start(req, paramsOf(new URL(req.url).searchParams));
}

export const POST = audited(async function POST(req) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  return start(req, paramsOf(form));
});
