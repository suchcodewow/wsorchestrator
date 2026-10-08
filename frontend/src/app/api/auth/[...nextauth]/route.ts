/**
 * Auth.js's own sign-in handlers, and the one OAuth callback every other
 * connection returns through too: a `GET /api/auth/callback/google` whose state
 * is one of ours goes to `lib/oauth-purposes.ts`, and everything else to
 * Auth.js. See `lib/oauth-callback.ts`.
 */

import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { isConnectState, OAUTH_CALLBACK_PATH } from "@/lib/oauth-callback";
import { handleConnectCallback } from "@/lib/oauth-purposes";

export async function GET(req: NextRequest) {
  if (req.nextUrl.pathname === OAUTH_CALLBACK_PATH && isConnectState(req.nextUrl.searchParams.get("state"))) {
    return handleConnectCallback(req);
  }
  return handlers.GET(req);
}

export const { POST } = handlers;
