"use client";

/** The two halves of the sign-in popup: off to Google, and back to the frame. */

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FRAME_TICKET_MESSAGE } from "@/lib/frame-cookie";

/** Starts Google's sign-in as soon as it loads; the button is for a browser that stops it. */
export function GoogleRedirect({ action }: { action: () => Promise<void> }) {
  const form = useRef<HTMLFormElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    form.current?.requestSubmit();
  }, []);

  return (
    <form ref={form} action={action} className="space-y-3">
      <p className="text-sm text-muted-foreground">Taking you to Google…</p>
      <Button type="submit" variant="brand" size="lg" className="group w-full">
        Continue with Google
        <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
      </Button>
    </form>
  );
}

const REFUSALS: Record<string, string> = {
  impersonating: "You're viewing the app as someone else. Stop that in the app first, then sign in again.",
};

/**
 * Posts a ticket to the frame that opened this window, and closes. With no
 * frame to post to — the window was opened some other way, or Google's pages
 * cut it off from its opener — it says to go back and try again, which then
 * needs no trip to Google.
 */
export function FrameHandoff({ email }: { email: string }) {
  const [message, setMessage] = useState("Signing you in…");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const opener = window.opener as Window | null;
    if (!opener) {
      setTimeout(() => setMessage(`Signed in as ${email}. Close this window and select Continue with Google again.`), 0);
      return;
    }
    void (async () => {
      const res = await fetch("/api/frame-session/ticket", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { token?: string; error?: string } | null;
      if (!res.ok || !body?.token) {
        setMessage(REFUSALS[body?.error ?? ""] ?? "Sign-in didn't finish. Close this window and try again.");
        return;
      }
      opener.postMessage({ type: FRAME_TICKET_MESSAGE, token: body.token }, location.origin);
      window.close();
      setMessage(`Signed in as ${email}. You can close this window.`);
    })();
  }, [email]);

  return (
    <p role="status" className="text-sm">
      {message}
    </p>
  );
}
