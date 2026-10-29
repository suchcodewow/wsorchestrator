/**
 * The sign-in popup a framed page opens (`src/lib/frame-cookie.ts`). Signed
 * out, it goes straight to Google and comes back here; signed in, it hands
 * the frame that opened it a ticket and closes.
 */

import type { Metadata } from "next";
import { auth, googleHostedDomain, signIn } from "@/auth";
import { BrandMark } from "@/components/brand-mark";
import { FRAME_SIGNIN_PATH } from "@/lib/frame-cookie";
import { FrameHandoff, GoogleRedirect } from "./frame-signin";

export const metadata: Metadata = { title: "Sign in — Harness Events" };

export default async function FrameSignInPage() {
  const session = await auth();

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 shadow-xl">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <span className="font-medium tracking-tight">Harness Events</span>
        </div>
        <div className="mt-6">
          {session?.user ? (
            <FrameHandoff email={session.user.email ?? session.user.name ?? "you"} />
          ) : (
            <GoogleRedirect
              action={async () => {
                "use server";
                const hd = await googleHostedDomain();
                await signIn("google", { redirectTo: FRAME_SIGNIN_PATH }, hd ? { hd } : undefined);
              }}
            />
          )}
        </div>
      </div>
    </main>
  );
}
