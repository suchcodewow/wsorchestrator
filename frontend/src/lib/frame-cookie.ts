/**
 * Signing in inside a frame on another site, such as a Mindtickle course.
 *
 * Auth.js's session cookie is `SameSite=Lax`, so a browser never sends it to
 * a page framed by another site, and Google's sign-in page refuses to be
 * framed at all. So a framed page signs in through a popup
 * (`/frame-signin`), which is a top-level window and has the ordinary
 * session; it hands the frame a one-minute ticket, and the frame trades that
 * for a session of its own (`src/lib/frame-session.ts`), kept in this
 * cookie. It is `SameSite=None; Partitioned`, so the browser keeps it only
 * for frames under the site it was set beneath and never sends it anywhere
 * else.
 *
 * The proxy hands that session to Auth.js under its own cookie name, so every
 * page, route and server action sees an ordinary signed-in request. A change
 * (anything but GET or HEAD) gets it only when it comes from this app's own
 * pages, so the site doing the framing cannot make changes as the learner.
 *
 * No `server-only`: the proxy imports this.
 */

export const FRAME_SESSION_COOKIE = "__Host-frame-session";

/** Auth.js's default session lifetime, which the frame's session copies. */
export const FRAME_SESSION_MAX_AGE = 30 * 24 * 60 * 60;

/** Auth.js's session cookie: the first over https, the second over http. */
const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"];

const SAFE_METHODS = new Set(["GET", "HEAD"]);

function cookieValues(header: string | null): Map<string, string> {
  const values = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!values.has(name)) values.set(name, part.slice(eq + 1).trim());
  }
  return values;
}

/** Whether a change was sent by this app's own pages rather than by another site. */
function sameOrigin(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Adds the frame's session to `headers` as Auth.js's session cookie, when it
 * has one and no ordinary session, and the request may carry it. Returns
 * whether it did.
 */
export function withFrameSession(headers: Headers, method: string): boolean {
  const cookies = cookieValues(headers.get("cookie"));
  const token = cookies.get(FRAME_SESSION_COOKIE);
  if (!token) return false;
  if (SESSION_COOKIES.some((name) => cookies.has(name))) return false;
  if (!SAFE_METHODS.has(method.toUpperCase()) && !sameOrigin(headers)) return false;

  const added = SESSION_COOKIES.map((name) => `${name}=${token}`).join("; ");
  const existing = headers.get("cookie");
  headers.set("cookie", existing ? `${existing}; ${added}` : added);
  return true;
}

/**
 * Whether a browser sent this request from another site. A client that is
 * not a browser sends no `Sec-Fetch-Site`, and is not refused.
 */
export function sentCrossSite(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin";
}

/** The message the sign-in popup posts its ticket to the frame with. */
export const FRAME_TICKET_MESSAGE = "frame-signin/ticket";

/** The popup a framed page signs in through. */
export const FRAME_SIGNIN_PATH = "/frame-signin";
