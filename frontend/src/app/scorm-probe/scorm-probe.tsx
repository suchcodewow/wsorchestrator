"use client";

/**
 * TEMPORARY PROBE: delete with everything else docs/probes.md lists for it.
 *
 * Framed by the SCORM shell from `/api/scorm-probe/package`, shows what this
 * page can learn inside Mindtickle: what the shell read from the SCORM API
 * and the shell's own origin, which cookies survive in the frame, whether the
 * app's session is visible, whether storage access can be had, and whether a
 * popup may open and report back (as a popup sign-in would). Nothing here
 * signs anyone in; the learner the shell names is unverified.
 */

import { Button, buttonVariants } from "@/components/ui/button";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const COOKIES_URL = "/api/scorm-probe/cookies";

type Cookies = { lax: boolean; none: boolean; partitioned: boolean };

type ShellContext = {
  origin: string;
  shellHref: string;
  apis: Record<string, boolean>;
  version: string | null;
  initialized: boolean;
  learnerId: string | null;
  learnerName: string | null;
  lessonStatus: string | null;
  error: string | null;
};

type Check = { cookies: Cookies | null; session: string | null; error?: string };

type Completion = { ok: boolean; error: string | null; lessonStatus: string | null };

/** Which cookies survive here: the first call sets them, the second says what came back. */
async function checkCookies(): Promise<Cookies> {
  await fetch(COOKIES_URL, { cache: "no-store" });
  const res = await fetch(COOKIES_URL, { cache: "no-store" });
  return ((await res.json()) as { arrived: Cookies }).arrived;
}

/** The email of the session this frame sends, or null for none. */
async function checkSession(): Promise<string | null> {
  const res = await fetch("/api/auth/session", { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as { user?: { email?: string } } | null;
  return body?.user?.email ?? null;
}

async function check(): Promise<Check> {
  try {
    const [cookies, session] = await Promise.all([checkCookies(), checkSession()]);
    return { cookies, session };
  } catch (e) {
    return { cookies: null, session: null, error: String(e) };
  }
}

const subscribeNothing = () => () => {};

function describeFrame() {
  const ancestors = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  return JSON.stringify({
    framed: window.parent !== window,
    ancestorOrigins: ancestors ? Array.from(ancestors) : "unsupported",
    referrer: document.referrer,
    popup: new URLSearchParams(location.search).has("popup") && !!window.opener,
  });
}

const yesNo = (v: boolean) => (v ? "✓ sent" : "✗ not sent");

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 px-5 py-4 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="wrap-break-word">{children}</div>
    </div>
  );
}

export function ScormProbe() {
  const frameJson = useSyncExternalStore(subscribeNothing, describeFrame, () => "");
  const frame = frameJson
    ? (JSON.parse(frameJson) as { framed: boolean; ancestorOrigins: string[] | string; referrer: string; popup: boolean })
    : null;

  const [shell, setShell] = useState<ShellContext | null>(null);
  const [here, setHere] = useState<Check | null>(null);
  const [storage, setStorage] = useState<string>("…");
  const [popup, setPopup] = useState<string>("not tried");
  const [popupReport, setPopupReport] = useState<Check | null>(null);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  const run = useCallback(async () => {
    setHere(await check());
    if (typeof document.hasStorageAccess !== "function") setStorage("unsupported");
    else setStorage((await document.hasStorageAccess()) ? "granted" : "not granted");
  }, []);

  // As the popup: check from a top-level window, report to the frame that opened it, and close.
  useEffect(() => {
    if (!frame?.popup) return;
    void check().then((report) => {
      window.opener?.postMessage({ type: "scorm-probe/popup", ...report }, location.origin);
      window.close();
    });
  }, [frame?.popup]);

  useEffect(() => {
    if (!frame || frame.popup) return;
    const timer = setTimeout(() => void run(), 0);

    function onMessage(event: MessageEvent) {
      const data = (event.data ?? {}) as { type?: string };
      if (event.source === window.parent && event.source !== window) {
        // The shell is whatever frames us; its origin is one of the things we are here to learn.
        if (data.type === "scorm-probe/context") setShell({ ...(data as ShellContext), origin: event.origin });
        else if (data.type === "scorm-probe/completed") setCompletion(data as Completion);
      } else if (event.source === popupRef.current && event.origin === location.origin && data.type === "scorm-probe/popup") {
        setPopupReport(data as Check);
      }
    }
    window.addEventListener("message", onMessage);
    // Nothing secret in it, and the shell's origin is not known yet.
    if (frame.framed) window.parent.postMessage({ type: "scorm-probe/ready" }, "*");

    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameJson, run]);

  async function requestStorage() {
    try {
      await document.requestStorageAccess();
      setStorage("granted on request");
      setHere(await check());
    } catch (e) {
      setStorage(`refused: ${String(e)}`);
    }
  }

  function openPopup() {
    setPopupReport(null);
    popupRef.current = window.open("/scorm-probe?popup=1", "scorm-probe-popup", "width=480,height=360");
    setPopup(popupRef.current ? "opened" : "blocked: the frame may be sandboxed without allow-popups");
  }

  function markComplete() {
    if (!shell) return;
    window.parent.postMessage({ type: "scorm-probe/complete" }, shell.origin);
  }

  async function copyReport() {
    const report = { frame, shell, here, storage, popup, popupReport, completion, userAgent: navigator.userAgent };
    const text = JSON.stringify(report, null, 2);
    // A frame may not be allowed the clipboard; then the report is shown to copy by hand.
    try {
      await navigator.clipboard.writeText(text);
      setCopied("copied");
    } catch {
      setCopied(text);
    }
  }

  if (frame?.popup) return <main className="px-5 py-8 text-sm">Reporting back…</main>;

  const cookies = (c: Cookies | null, error?: string) =>
    c ? `Lax ${yesNo(c.lax)} · None ${yesNo(c.none)} · Partitioned ${yesNo(c.partitioned)}` : (error ?? "…");

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-5 py-8">
      <h1 className="text-xl font-semibold">SCORM probe</h1>

      <div className="divide-y divide-border rounded-2xl border border-border">
        <Row label="Framed">
          {frame === null ? "…" : frame.framed ? "yes" : "no — open this page through the SCORM package"}
          {frame?.framed && (
            <div className="mt-1 font-mono text-xs">
              ancestors {JSON.stringify(frame.ancestorOrigins)} · referrer {frame.referrer || "(none)"}
            </div>
          )}
        </Row>
        <Row label="SCORM shell">
          {shell ? (
            <div className="space-y-1 font-mono text-xs">
              <div>origin {shell.origin || "(opaque)"}</div>
              <div>href {shell.shellHref}</div>
              <div>
                API {shell.version ?? "none"} (found: {JSON.stringify(shell.apis)}) · initialized {String(shell.initialized)}
              </div>
              <div>learner id {shell.learnerId ?? "(empty)"} · name {shell.learnerName ?? "(empty)"}</div>
              <div>lesson status {shell.lessonStatus ?? "(empty)"}</div>
              {shell.error && <div className="text-destructive">{shell.error}</div>}
            </div>
          ) : frame?.framed ? (
            "waiting for the shell"
          ) : (
            "none"
          )}
        </Row>
        <Row label="Cookies in this window">{cookies(here?.cookies ?? null, here?.error)}</Row>
        <Row label="App session in this window">{here ? (here.session ?? "none visible") : "…"}</Row>
        <Row label="Storage access">
          <div className="flex flex-wrap items-center gap-3">
            <span>{storage}</span>
            {storage === "not granted" && (
              <Button size="sm" variant="outline" onClick={() => void requestStorage()}>
                Request storage access
              </Button>
            )}
          </div>
        </Row>
        <Row label="Popup">
          <div className="flex flex-wrap items-center gap-3">
            <span>{popup}</span>
            <Button size="sm" variant="outline" onClick={openPopup}>
              Open a popup
            </Button>
          </div>
          {popupReport && (
            <div className="mt-1 font-mono text-xs">
              the popup saw session {popupReport.session ?? "none"} · cookies {cookies(popupReport.cookies, popupReport.error)}
            </div>
          )}
        </Row>
        <Row label="Completion">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              {completion
                ? `${completion.ok ? "committed" : "failed"} · lesson status ${completion.lessonStatus ?? "(empty)"}${completion.error ? ` · ${completion.error}` : ""}`
                : "not sent"}
            </span>
            <Button size="sm" variant="outline" disabled={!shell?.initialized} onClick={markComplete}>
              Mark complete
            </Button>
          </div>
        </Row>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void copyReport()}>
          {copied === null ? "Copy report" : copied === "copied" ? "Copied" : "Clipboard blocked: copy the report below"}
        </Button>
        {frame && !frame.framed && (
          <a href="/api/scorm-probe/package" className={buttonVariants({ size: "sm", variant: "outline" })}>
            Download SCORM package
          </a>
        )}
      </div>
      {copied && copied !== "copied" && (
        <pre className="wrap-break-word whitespace-pre-wrap rounded-2xl border border-border px-5 py-4 font-mono text-xs">{copied}</pre>
      )}
    </main>
  );
}
