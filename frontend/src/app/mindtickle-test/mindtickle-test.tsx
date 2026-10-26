"use client";

/**
 * Loaded inside a Mindtickle frame, asks the parent window who the user is
 * with `postMessage` and shows every message that comes back. Nothing here
 * establishes a session; it only reports what Mindtickle sends.
 */

import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const MINDTICKLE_HOST = /(^|\.)mindtickle\.com$/;

type Entry = { at: string; verdict: string; detail: string };

/** The origin when it is an https Mindtickle host, else null. */
function mindtickleOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && MINDTICKLE_HOST.test(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
}

/** Show a token's ends, not the whole credential. */
function redact(data: unknown): string {
  if (typeof data !== "object" || data === null) return JSON.stringify(data);
  const copy = { ...(data as Record<string, unknown>) };
  if (typeof copy.token === "string" && copy.token.length > 12) {
    copy.token = `${copy.token.slice(0, 6)}…${copy.token.slice(-4)} (${copy.token.length} chars)`;
  }

  return JSON.stringify(copy, null, 2);
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

export function MindtickleTest() {
  // Browser-only facts: unknown (null) while rendering on the server.
  const framed = useSyncExternalStore(subscribeNothing, () => window.parent !== window, () => null);
  // The referrer of a framed page is the embedding page, the likeliest target.
  const referrer = useSyncExternalStore(subscribeNothing, referrerOrigin, () => "");
  const [typedOrigin, setTypedOrigin] = useState<string | null>(null);
  const parentOrigin = typedOrigin ?? referrer;
  const [log, setLog] = useState<Entry[]>([]);
  const [identity, setIdentity] = useState<{ userEmail?: string; token?: string } | null>(null);

  const add = useCallback((verdict: string, detail: string) => {
    setLog((rows) => [{ at: new Date().toLocaleTimeString(), verdict, detail }, ...rows]);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Anyone can frame this page or message this window; only Mindtickle is believed.
      if (!mindtickleOrigin(event.origin)) {
        add("ignored", `from ${event.origin}`);
        return;
      }

      const { action, token, userEmail } = (event.data ?? {}) as Record<string, string | undefined>;
      if (action === "MT_AUTH_RESPONSE") {
        setIdentity({ userEmail, token });
        add("accepted", `MT_AUTH_RESPONSE from ${event.origin}\n${redact(event.data)}`);
      } else {
        add("other", `from ${event.origin}\n${redact(event.data)}`);
      }
    }

    window.addEventListener("message", onMessage);

    return () => window.removeEventListener("message", onMessage);
  }, [add]);

  function request() {
    const target = mindtickleOrigin(parentOrigin.trim());
    if (!target) {
      add("not sent", "Enter the https origin of your Mindtickle tenant, e.g. https://yourcompany.mindtickle.com");
      return;
    }

    window.parent.postMessage({ action: "REQUEST_MT_AUTH" }, target);
    add("sent", `REQUEST_MT_AUTH to ${target}`);
  }

  // Ask once on load when the embedding page is known, as an embedded app would.
  useEffect(() => {
    if (!framed || !referrer) return;
    const timer = setTimeout(request, 0);

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
        <div className="space-y-2 px-5 py-4">
          <label htmlFor="mt-origin" className="text-sm text-muted-foreground">
            Mindtickle origin to message
          </label>
          <div className="flex gap-2">
            <input
              id="mt-origin"
              value={parentOrigin}
              onChange={(e) => setTypedOrigin(e.target.value)}
              placeholder="https://yourcompany.mindtickle.com"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <Button onClick={request}>Request identity</Button>
          </div>
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
