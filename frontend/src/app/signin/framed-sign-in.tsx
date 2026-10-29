"use client";

/**
 * The sign-in button, when the page is framed by another site. Google will
 * not be framed, so it opens the sign-in popup and waits for the ticket the
 * popup posts back, then trades it for the frame's own session. See
 * `src/lib/frame-cookie.ts`. Not framed, it shows the ordinary form it wraps.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FRAME_SIGNIN_PATH, FRAME_TICKET_MESSAGE } from "@/lib/frame-cookie";
import { isFramed } from "@/lib/framed";

const subscribeNothing = () => () => {};

type State = "idle" | "waiting" | "claiming";

/** Whether the browser now sends this frame a session. */
async function signedInHere(): Promise<boolean> {
  const res = await fetch("/api/auth/session", { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as { user?: unknown } | null;
  return Boolean(body?.user);
}

export function FramedSignIn({
  target,
  className,
  children,
}: {
  target: string;
  className?: string;
  children: React.ReactNode;
}) {
  const framed = useSyncExternalStore(subscribeNothing, isFramed, () => false);
  const popupRef = useRef<Window | null>(null);
  const [state, setState] = useState<State>("idle");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!framed) return;

    async function onMessage(event: MessageEvent) {
      if (event.source !== popupRef.current || event.origin !== location.origin) return;
      const data = (event.data ?? {}) as { type?: string; token?: unknown };
      if (data.type !== FRAME_TICKET_MESSAGE || typeof data.token !== "string") return;

      setState("claiming");
      const res = await fetch("/api/frame-session/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: data.token }),
      });
      if (res.ok && (await signedInHere())) {
        location.replace(target);
        return;
      }
      setState("idle");
      setProblem(
        res.ok
          ? "This browser keeps no cookies for a page inside another site, so you can't stay signed in here. Open the app in its own tab instead."
          : "Sign-in didn't finish. Try again.",
      );
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [framed, target]);

  if (!framed) return children;

  function openPopup() {
    setProblem(null);
    popupRef.current = window.open(FRAME_SIGNIN_PATH, "frame-signin", "popup,width=500,height=640");
    if (popupRef.current) {
      setState("waiting");
    } else {
      setState("idle");
      setProblem("Your browser blocked the sign-in window. Allow pop-ups for this page and try again.");
    }
  }

  return (
    <div data-anim className={className}>
      <Button
        type="button"
        variant="brand"
        size="lg"
        className="group w-full"
        disabled={state === "claiming"}
        onClick={openPopup}
      >
        Continue with Google
        <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
      </Button>
      <p role="status" className="mt-3 text-center text-xs text-muted-foreground">
        {state === "claiming"
          ? "Signing you in…"
          : state === "waiting"
            ? "Finish signing in in the window that opened."
            : "Google sign-in opens in a new window."}
      </p>
      {problem && (
        <p role="alert" className="mt-2 text-center text-sm text-destructive">
          {problem}{" "}
          {problem.startsWith("This browser") && (
            <a href={target} target="_blank" rel="noopener" className="underline">
              Open in a new tab
            </a>
          )}
        </p>
      )}
    </div>
  );
}
