"use client";

/**
 * TEMPORARY PROBE: delete with everything else docs/probes.md lists for it.
 *
 * Loaded inside a Mindtickle frame, shows everything the embedding page gives
 * this one: the URL it loaded us with, the referrer, every message it posts,
 * and the replies to probes we post up to it. Nothing here establishes a
 * session; it only reports.
 */

import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const MINDTICKLE_HOST = /(^|\.)mindtickle\.com$/;

type Entry = { at: string; verdict: string; detail: string };

/** Messages to try on the parent; Mindtickle's real protocol is not documented. */
const PROBES: { label: string; message: unknown }[] = [
  { label: "REQUEST_MT_AUTH", message: { action: "REQUEST_MT_AUTH" } },
  { label: "ready", message: { type: "ready" } },
  { label: "getUser", message: { type: "getUser" } },
  { label: "GET_USER_CONTEXT", message: { action: "GET_USER_CONTEXT" } },
  { label: "init", message: "init" },
  { label: "page_loaded", message: "$#@page_loaded@#$" },
];

/** The origin when it is an https Mindtickle host, else null. */
function mindtickleOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && MINDTICKLE_HOST.test(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
}

/** Show a token's ends, not the whole credential, at any depth. */
function redact(data: unknown): string {
  return JSON.stringify(
    data,
    (key, value) =>
      /token|jwt|secret|signature/i.test(key) && typeof value === "string" && value.length > 12
        ? `${value.slice(0, 6)}…${value.slice(-4)} (${value.length} chars)`
        : value,
    2,
  );
}

const subscribeNothing = () => () => {};

/** The origin of the embedding page, when it is a Mindtickle one. */
function referrerOrigin(): string {
  try {
    return (document.referrer && mindtickleOrigin(new URL(document.referrer).origin)) || "";
  } catch {
    return "";
  }
}

/** Everything about how this page was loaded, as one snapshot. */
function describeEnvironment(): string {
  const params = Object.fromEntries(new URLSearchParams(location.search));
  const hash = Object.fromEntries(new URLSearchParams(location.hash.replace(/^#\??/, "")));
  const ancestors = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;

  return redact({
    href: location.href,
    query: params,
    hash: location.hash,
    hashParams: hash,
    referrer: document.referrer,
    ancestorOrigins: ancestors ? Array.from(ancestors) : "unsupported",
    windowName: window.name,
    framed: window.parent !== window,
    topIsParent: window.top === window.parent,
    cookieEnabled: navigator.cookieEnabled,
    cookieNames: document.cookie ? document.cookie.split(";").map((c) => c.split("=")[0]?.trim()) : [],
    userAgent: navigator.userAgent,
  });
}

export function MindtickleTest() {
  // Browser-only facts: unknown (null) while rendering on the server.
  const framed = useSyncExternalStore(subscribeNothing, () => window.parent !== window, () => null);
  // The referrer of a framed page is the embedding page, the likeliest target.
  const referrer = useSyncExternalStore(subscribeNothing, referrerOrigin, () => "");
  const environment = useSyncExternalStore(subscribeNothing, describeEnvironment, () => "");
  const [typedOrigin, setTypedOrigin] = useState<string | null>(null);
  const parentOrigin = typedOrigin ?? referrer;
  const [custom, setCustom] = useState('{"action":"REQUEST_MT_AUTH"}');
  const [log, setLog] = useState<Entry[]>([]);
  const [identity, setIdentity] = useState<{ userEmail?: string; token?: string } | null>(null);

  const add = useCallback((verdict: string, detail: string) => {
    setLog((rows) => [{ at: new Date().toLocaleTimeString(), verdict, detail }, ...rows]);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const where = `from ${event.origin || "(no origin)"}${event.source === window.parent ? " (parent)" : event.source === window ? " (self)" : " (other window)"}`;
      const body = redact(event.data);

      // Anyone can frame this page or message this window. Show it all, believe only Mindtickle.
      if (!mindtickleOrigin(event.origin)) {
        add("not trusted", `${where}\n${body}`);
        return;
      }

      const { action, token, userEmail } = (event.data ?? {}) as Record<string, string | undefined>;
      if (action === "MT_AUTH_RESPONSE") {
        setIdentity({ userEmail, token });
        add("identity", `MT_AUTH_RESPONSE ${where}\n${body}`);
      } else {
        add("message", `${where}\n${body}`);
      }
    }

    window.addEventListener("message", onMessage);

    return () => window.removeEventListener("message", onMessage);
  }, [add]);

  /** Post to the parent (and the top window, when that is another frame up). */
  function send(message: unknown) {
    const target = mindtickleOrigin(parentOrigin.trim());
    if (!target) {
      add("not sent", "Enter the https origin of your Mindtickle tenant, e.g. https://yourcompany.mindtickle.com");
      return;
    }

    window.parent.postMessage(message, target);
    if (window.top && window.top !== window.parent) window.top.postMessage(message, target);
    add("sent", `to ${target}\n${redact(message)}`);
  }

  function sendCustom() {
    try {
      send(JSON.parse(custom));
    } catch {
      send(custom);
    }
  }

  // Ask once on load when the embedding page is known, as an embedded app would.
  useEffect(() => {
    if (!framed || !referrer) return;
    const timer = setTimeout(() => send(PROBES[0]!.message), 0);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framed, referrer]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-5 py-8">
      <h1 className="text-xl font-semibold">Mindtickle identity test</h1>

      <div className="divide-y divide-border rounded-2xl border border-border">
        <div className="px-5 py-4 text-sm">
          <span className="text-muted-foreground">Framed: </span>
          {framed === null ? "…" : framed ? "yes" : "no — open this page inside Mindtickle"}
        </div>
        <div className="px-5 py-4 text-sm">
          <span className="text-muted-foreground">Identity: </span>
          {identity ? (
            <span>
              {identity.userEmail ?? "(no userEmail)"}
              {identity.token ? ` · token received (${identity.token.length} chars)` : " · no token"}
            </span>
          ) : (
            "none received yet"
          )}
        </div>
        <div className="space-y-2 px-5 py-4">
          <div className="text-sm text-muted-foreground">How this page was loaded</div>
          <pre className="wrap-break-word whitespace-pre-wrap font-mono text-xs">{environment}</pre>
        </div>
        <div className="space-y-3 px-5 py-4">
          <label htmlFor="mt-origin" className="text-sm text-muted-foreground">
            Mindtickle origin to message
          </label>
          <input
            id="mt-origin"
            value={parentOrigin}
            onChange={(e) => setTypedOrigin(e.target.value)}
            placeholder="https://yourcompany.mindtickle.com"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            {PROBES.map((p) => (
              <Button key={p.label} variant="outline" size="sm" onClick={() => send(p.message)}>
                {p.label}
              </Button>
            ))}
            <Button size="sm" onClick={() => PROBES.forEach((p) => send(p.message))}>
              Send all
            </Button>
          </div>
          <textarea
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            rows={3}
            aria-label="Custom message"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
          />
          <Button size="sm" onClick={sendCustom}>
            Send custom (JSON or text)
          </Button>
        </div>
      </div>

      <div className="divide-y divide-border rounded-2xl border border-border">
        {log.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          log.map((row, i) => (
            <div key={i} className="px-5 py-4 text-sm">
              <div className="mb-1 text-xs text-muted-foreground">
                {row.at} · {row.verdict}
              </div>
              <pre className="wrap-break-word whitespace-pre-wrap font-mono text-xs">{row.detail}</pre>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
