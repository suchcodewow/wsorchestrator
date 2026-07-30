import { NextResponse, type NextRequest } from "next/server";

/**
 * Collapse every hostname the app is served on down to one canonical origin.
 *
 * The app answers on several hosts — the apex, `www`, and the raw
 * `*.run.app` URL — but sign-in only works on one of them. Auth.js pins a
 * single `AUTH_URL`, and Google matches the OAuth `redirect_uri` character for
 * character, so a user who starts on `www` and gets redirected mid-flow lands
 * on a URI the OAuth client has never heard of. Redirecting up front means the
 * whole session happens on the host the credentials were issued for.
 *
 * `CANONICAL_HOST` is derived from `app_url` in Terraform, so it cannot drift
 * from `AUTH_URL`. Unset (local dev, or before a custom domain exists) makes
 * this a no-op.
 */
export function middleware(request: NextRequest) {
  const canonical = process.env.CANONICAL_HOST;
  if (!canonical) return NextResponse.next();

  // Cloud Run terminates TLS and forwards the original host; `host` alone
  // would be the internal one.
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");

  if (!host || host === canonical) return NextResponse.next();

  const url = new URL(request.url);
  url.host = canonical;
  url.protocol = "https:";
  // Cloud Run listens on 8080 internally; carrying that into a public
  // redirect would produce https://host:8080.
  url.port = "";

  // 308 rather than 301: it is cacheable like 301 but guarantees the method
  // and body survive, so a POSTed server action is not silently turned into a
  // GET on the way across.
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own static output and the favicon. API routes
     * are deliberately included — `/api/auth/*` is exactly the traffic that
     * has to be on the canonical host.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
