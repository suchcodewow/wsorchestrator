/** Reading the route files under src/app/api, for the suites that hold other things to them. */

import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const API_DIR = join(import.meta.dirname, "../../src/app/api");

export function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

/** "src/app/api/runs/[id]/end/route.ts" → "/api/runs/{id}/end". */
export function urlPath(file: string): string {
  const dir = relative(API_DIR, file).split(sep).slice(0, -1);
  const segments = dir.map((s) =>
    s.replace(/^\[\.\.\.(.+)\]$/, "{...$1}").replace(/^\[(.+)\]$/, "{$1}"),
  );
  return ["/api", ...segments].join("/");
}

export const CALLS_AUTH = /\bawait auth\(\)/;

/**
 * Each top-level function in a file, keyed by name, with its source. A
 * handler exported as `export const POST = audited(async function POST(…`
 * counts as an exported function.
 */
export function topLevelFunctions(source: string): Map<string, { exported: boolean; body: string }> {
  const starts = [...source.matchAll(/^(export )?(?:const \w+ = audited\()?(?:async )?function (\w+)/gm)];
  const out = new Map<string, { exported: boolean; body: string }>();
  starts.forEach((m, i) => {
    const end = starts[i + 1]?.index ?? source.length;
    out.set(m[2]!, { exported: Boolean(m[1]), body: source.slice(m.index, end) });
  });
  return out;
}
