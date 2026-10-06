/**
 * Whether a request carries a Google-signed OIDC token for `audience` from the
 * service account `invoker`. The app is public, so Cloud Run's IAM does not
 * stand between a scheduled route and the internet; this is what does.
 * Either value unset refuses every call.
 */

import "server-only";

import { OAuth2Client } from "google-auth-library";

const google = new OAuth2Client();

export async function fromInvoker(req: Request, audience: string | undefined, invoker: string | undefined): Promise<boolean> {
  if (!audience || !invoker) return false;
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return false;
  try {
    const payload = (await google.verifyIdToken({ idToken: token, audience })).getPayload();
    return payload?.email === invoker && payload.email_verified === true;
  } catch {
    return false;
  }
}
