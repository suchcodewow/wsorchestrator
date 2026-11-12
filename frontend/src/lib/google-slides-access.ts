/**
 * The Google side every generated slide shares: the account connected for
 * Google Meetings, checked for the Slides and Drive scopes, and the two API
 * clients made with its token. The thank-you slide and the breakout slide both
 * start here.
 */

import "server-only";

import { accessToken, calendarClient, GoogleError, oauthClient, GOOGLE_MEETING_SCOPES, type CalendarClient } from "@/lib/google-calendar";
import { googleConnection } from "@/lib/evals/google-meetings";
import { DRIVE_API, SLIDES_API } from "@/lib/google-slides";
import { openSecret } from "@/lib/secret-box";

export type GoogleSlidesFailure = {
  ok: false;
  error: "google_not_configured" | "google_not_connected" | "google_reconnect";
  message: string;
};

type OAuthClient = NonNullable<ReturnType<typeof oauthClient>>;
type Connection = NonNullable<Awaited<ReturnType<typeof googleConnection>>>;

/** The connected account, when Google is configured and it was connected with the scopes slides need. */
export async function googleSlidesConnection(): Promise<{ ok: true; client: OAuthClient; connection: Connection } | GoogleSlidesFailure> {
  const client = oauthClient();
  if (!client) return { ok: false, error: "google_not_configured", message: "AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are not set." };
  const connection = await googleConnection();
  if (!connection)
    return {
      ok: false,
      error: "google_not_connected",
      message: "No Google account is connected. Connect one under Admin Settings → External Connectors.",
    };
  const granted = new Set(connection.scope.split(" "));
  if (!GOOGLE_MEETING_SCOPES.filter((s) => s.startsWith("https://")).every((s) => granted.has(s))) {
    return {
      ok: false,
      error: "google_reconnect",
      message: `${connection.email} was connected before slides were needed. Connect the Google account again under Admin Settings → External Connectors.`,
    };
  }
  return { ok: true, client, connection };
}

/** The Slides and Drive clients for the connection; Google refusing its token is a `google_reconnect`, anything else throws. */
export async function openSlidesClients(
  client: OAuthClient,
  connection: Connection,
): Promise<{ ok: true; slides: CalendarClient; drive: CalendarClient } | GoogleSlidesFailure> {
  const refreshToken = openSecret(connection.refreshToken);
  if (!refreshToken)
    return { ok: false, error: "google_reconnect", message: "The stored Google token cannot be opened here. Connect the account again." };
  try {
    const access = await accessToken(client, refreshToken);
    return { ok: true, slides: calendarClient(access, SLIDES_API), drive: calendarClient(access, DRIVE_API) };
  } catch (err) {
    if (err instanceof GoogleError && err.revoked) return revoked(connection);
    throw err;
  }
}

/** The failure for Google no longer accepting the connected account's token, for a call that was refused after the clients were made. */
export function revoked(connection: Connection): GoogleSlidesFailure {
  return {
    ok: false,
    error: "google_reconnect",
    message: `Google no longer accepts ${connection.email}'s token. Connect the account again.`,
  };
}
