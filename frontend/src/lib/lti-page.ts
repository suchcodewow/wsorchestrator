/**
 * TEMPORARY PROBE: delete with everything else docs/probes.md lists for it.
 *
 * The page a launch answers with, inside Mindtickle's iframe: each check and
 * every claim the id_token carried. Plain HTML from the route handler, since
 * the launch is a cross-site form POST that a React page cannot receive.
 */

import "server-only";

import type { LaunchResult } from "@/lib/lti";

/** Who may frame these pages: the app itself and Mindtickle. */
export const LTI_FRAME_ANCESTORS = "'self' https://*.mindtickle.com";

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const json = (value: unknown) => escape(JSON.stringify(value, null, 2));

export function launchPage(result: LaunchResult | null, platformError?: { error: string; description: string | null }): string {
  const heading = platformError
    ? "Mindtickle refused the launch"
    : result?.verified
      ? "Launch verified"
      : "Launch not verified";

  const sections: string[] = [];
  if (platformError) {
    sections.push(
      `<p><code>${escape(platformError.error)}</code>${platformError.description ? ` — ${escape(platformError.description)}` : ""}</p>`,
    );
  }
  if (result) {
    sections.push(
      `<table>${result.checks
        .map((c) => `<tr><td>${c.ok ? "✓" : "✗"}</td><td>${escape(c.name)}</td><td>${escape(c.detail)}</td></tr>`)
        .join("")}</table>`,
    );
    const signed = result.checks.find((c) => c.name === "signature")?.ok;
    if (result.claims) {
      sections.push(`<h2>Claims${signed ? "" : " (unverified: the signature did not check out)"}</h2><pre>${json(result.claims)}</pre>`);
    }
    if (result.header) sections.push(`<h2>Header</h2><pre>${json(result.header)}</pre>`);
  }

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>LTI launch — Harness Events</title>
<style>
  :root { color-scheme: light dark; font: 14px/1.5 system-ui, sans-serif; }
  body { margin: 0 auto; max-width: 48rem; padding: 2rem 1.25rem; }
  h1 { font-size: 1.25rem; } h2 { font-size: 1rem; margin-top: 1.5rem; }
  table { border-collapse: collapse; width: 100%; } td { border-top: 1px solid #8884; padding: .5rem; vertical-align: top; }
  td:first-child { width: 1.5rem; } td:nth-child(2) { white-space: nowrap; font-family: ui-monospace, monospace; }
  pre { overflow-wrap: anywhere; white-space: pre-wrap; font: 12px/1.45 ui-monospace, monospace; }
</style></head>
<body><h1>${heading}</h1>${sections.join("\n")}</body></html>`;
}
