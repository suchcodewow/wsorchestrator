/** The edge middleware: one canonical origin, and asset misses. */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { NextResponse, type NextRequest } from "next/server";

function canonicalRedirect(request: NextRequest): NextResponse | null {
  const canonical = process.env.CANONICAL_HOST;
  if (!canonical) return null;

  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");

  if (!host || host === canonical) return null;

  const url = new URL(request.url);
  url.host = canonical;
  url.protocol = "https:";
  url.port = "";

  return NextResponse.redirect(url, 308);
}

function publicFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? publicFiles(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

let served: Set<string>;
try {
  served = new Set(publicFiles(join(process.cwd(), "public")));
} catch {
  served = new Set();
}

const ASSET = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot)$/i;

function assetMiss(request: NextRequest): NextResponse | null {
  const path = request.nextUrl.pathname.slice(1);
  if (!ASSET.test(path) || served.has(path)) return null;

  return new NextResponse(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export function proxy(request: NextRequest) {
  return canonicalRedirect(request) ?? assetMiss(request) ?? NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
