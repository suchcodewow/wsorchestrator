import { readdirSync } from "node:fs";
import { join } from "node:path";
import { NextResponse, type NextRequest } from "next/server";

// `node:fs` needs no runtime declaration here: a Next 16 proxy file always runs
// on Node, and saying so explicitly is a build error. `assetMiss` below relies
// on that to read the real contents of `public/` rather than keeping a second
// copy of that list in this file, which would drift from it.

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
function canonicalRedirect(request: NextRequest): NextResponse | null {
  const canonical = process.env.CANONICAL_HOST;
  if (!canonical) return null;

  // Cloud Run terminates TLS and forwards the original host; `host` alone
  // would be the internal one.
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");

  if (!host || host === canonical) return null;

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

/**
 * Everything actually in `public/`, resolved once per container.
 *
 * Read at module load, not per request — the directory is baked into the image
 * and cannot change under a running revision, so re-reading it would be a
 * syscall per 404 to answer a question with a constant answer. Nested paths are
 * included, so a future `public/img/` would be served normally rather than
 * swallowed by the very check that exists to make its absence cheap.
 */
function publicFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? publicFiles(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

// A failure here must not take the service down: an unreadable `public/` should
// cost the old behaviour (a 404 that renders the layout), not a 500 on assets.
// An empty set means `assetMiss` declines every time and nothing is intercepted.
let served: Set<string>;
try {
  served = new Set(publicFiles(join(process.cwd(), "public")));
} catch {
  served = new Set();
}

/** Image and font extensions — see the note in `assetMiss`. */
const ASSET = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot)$/i;

/**
 * Answer 404 for a missing static asset without waking the app router.
 *
 * A request for a file that does not exist — `/img/canary.png`, say — matches no
 * route, so Next renders the not-found page, and that renders the root layout,
 * and *that* awaits `getThemePreference()`. A missing PNG therefore costs a
 * database query and one of the pool's five connections. Warm, it is 30ms and
 * invisible. It stopped being invisible on 2026-09-07: a Cloud SQL connector
 * dial hung for its full 10s timeout and six parallel image 404s sat behind it,
 * alongside the upload the author was actually waiting on, all returning at
 * 10.37s. That is what proved these 404s reach the database at all — a static
 * miss has no other reason to wait on Postgres.
 *
 * The trigger is a Markdown import: paste a guide written for the old static
 * site and its `/img/...` references resolve against this app, which has never
 * served that prefix. Nothing is stored wrong — those references live in the
 * editor's unsaved draft, and no row in the database contains one — so there is
 * no content to correct here, only a cost to stop paying while someone is
 * mid-import.
 *
 * Images and fonts only. Deliberately not `.txt`, `.xml`, `.css` or `.js`:
 * those are what Next's generated metadata routes emit (`robots.ts`,
 * `sitemap.ts`). None exist here today, but adding one later should not have to
 * remember this file — whereas nothing in this app will ever *generate* a `.png`
 * at an arbitrary path. Real guide images are served from
 * `/api/lab-images/<uuid>`, which has no extension and so never matches.
 */
function assetMiss(request: NextRequest): NextResponse | null {
  const path = request.nextUrl.pathname.slice(1);
  if (!ASSET.test(path) || served.has(path)) return null;

  // `Cache-Control: no-store` deliberately: a 404 here means "not imported
  // yet", and an author who pastes the image a minute later should not have to
  // fight a cached miss to see it appear.
  return new NextResponse(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export function proxy(request: NextRequest) {
  // Canonical host first: a request on the wrong origin should be moved before
  // anything else decides what to answer, so there is one origin in the logs
  // and one in the browser's address bar regardless of the outcome.
  return canonicalRedirect(request) ?? assetMiss(request) ?? NextResponse.next();
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
