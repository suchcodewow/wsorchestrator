/**
 * Every 404: an unmatched URL, or a page that called `notFound()` with no
 * closer boundary. Each one draws a different scene; see `scenes.ts`.
 */

import { SCENES, pickScene } from "@/components/not-found/scenes";
import "@/components/not-found/scenes.css";
import { REQUEST_PATH_HEADER } from "@/lib/request-path";
import type { Metadata } from "next";
import { headers } from "next/headers";

export const metadata: Metadata = { title: "Page not found · Harness Events" };

export default async function NotFound() {
  // The proxy hands over the requested path; the scenes quote it back.
  const requested = new URL((await headers()).get(REQUEST_PATH_HEADER) ?? "/", "http://path.invalid");
  const Scene = SCENES[pickScene(requested.searchParams.get("scene"))];

  return <Scene path={decodePath(requested.pathname)} />;
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
