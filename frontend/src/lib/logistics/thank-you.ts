/**
 * The Guest judges tab's Generate Thank You Page: one Google Slides slide
 * saying "Thank You!" over the judges' round Slack photos, the latest cohort first; anyone Slack has no photo for is left off. The
 * deck is made by the Google account connected for Google Meetings, which
 * needs the Slides and Drive scopes (`GOOGLE_MEETING_SCOPES`), and put in the
 * Drive folder `THANK_YOU_FOLDER_ID` as "BootCamp Thank You" (a deck already
 * there by that name is trashed first), and shared with whoever asked.
 */

import "server-only";

import { accessToken, calendarClient, GoogleError, oauthClient, GOOGLE_MEETING_SCOPES } from "@/lib/google-calendar";
import { googleConnection } from "@/lib/evals/google-meetings";
import { createThankYouDeck, DRIVE_API, SLIDES_API, type SlideJudge } from "@/lib/google-slides";
import { thankYouJudges } from "@/lib/logistics/guest-judges";
import { photoLink } from "@/lib/logistics/thank-you-photo";
import { openSecret } from "@/lib/secret-box";
import { slackClient, slackToken, SlackError } from "@/lib/slack";

export type ThankYouResult =
  | { ok: true; url: string; judges: number; withPhotos: number }
  | { ok: false; error: "google_not_configured" | "google_not_connected" | "google_reconnect" | "slack_not_connected" | "no_judges" | "failed"; message: string };

/** The Drive folder the deck goes in, and the name it has there. */
const THANK_YOU_FOLDER_ID = "10Yvy8SSz0x859Ymnx2J4bFYsYlVYNPhI";
const THANK_YOU_TITLE = "BootCamp Thank You";

const SLACK_BUDGET_MS = 60_000;
const PARALLEL = 4;

/** Each email's Slack profile photo, or null for someone Slack has no account for. */
async function slackPhotos(token: string, emails: string[]): Promise<Map<string, string>> {
  const slack = slackClient(token, Date.now() + SLACK_BUDGET_MS);
  const photos = new Map<string, string>();
  for (let i = 0; i < emails.length; i += PARALLEL) {
    await Promise.all(
      emails.slice(i, i + PARALLEL).map(async (email) => {
        try {
          const { user } = await slack.call<{ user: { deleted?: boolean; profile?: { image_192?: string; is_custom_image?: boolean } } }>(
            "users.lookupByEmail",
            { email },
          );
          const image = user.profile?.image_192;
          // Slack's stock avatar is a gravatar-style placeholder, not the person.
          if (!user.deleted && image && user.profile?.is_custom_image !== false) photos.set(email, image);
        } catch (err) {
          if (!(err instanceof SlackError && err.error === "users_not_found")) throw err;
        }
      }),
    );
  }
  return photos;
}

/** The app's public origin, which Google fetches the round photos from. */
function appOrigin(): string {
  const origin = process.env.AUTH_URL?.replace(/\/+$/, "");
  if (!origin) throw new Error("AUTH_URL is not set, so Google cannot fetch the photos.");
  return origin;
}

export async function generateThankYou(shareWith: string): Promise<ThankYouResult> {
  const client = oauthClient();
  if (!client) return { ok: false, error: "google_not_configured", message: "AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are not set." };
  const connection = await googleConnection();
  if (!connection) return { ok: false, error: "google_not_connected", message: "No Google account is connected. Connect one under Admin Settings → External Connectors." };
  const granted = new Set(connection.scope.split(" "));
  if (!GOOGLE_MEETING_SCOPES.filter((s) => s.startsWith("https://")).every((s) => granted.has(s))) {
    return { ok: false, error: "google_reconnect", message: `${connection.email} was connected before slides were needed. Connect the Google account again under Admin Settings → External Connectors.` };
  }
  const token = await slackToken();
  if (!token) return { ok: false, error: "slack_not_connected", message: "Slack is not connected, so there are no photos to use." };

  const judges = await thankYouJudges();
  if (judges.length === 0) return { ok: false, error: "no_judges", message: "No guest judges are listed yet." };

  try {
    const emails = [...new Set(judges.flatMap((j) => (j.email ? [j.email.toLowerCase()] : [])))];
    const photos = await slackPhotos(token, emails);
    // Someone Slack has no photo for is left off the slide.
    const people: SlideJudge[] = judges.flatMap((j) => {
      const photo = j.email && photos.get(j.email.toLowerCase());
      return photo ? [{ name: j.fullName, photoUrl: photoLink(appOrigin(), photo, j.times >= 2 ? "orange" : "blue"), times: j.times }] : [];
    });
    if (people.length === 0) return { ok: false, error: "no_judges", message: "None of the guest judges has a Slack photo." };

    const refreshToken = openSecret(connection.refreshToken);
    if (!refreshToken) return { ok: false, error: "google_reconnect", message: "The stored Google token cannot be opened here. Connect the account again." };
    const access = await accessToken(client, refreshToken);
    const deck = await createThankYouDeck(calendarClient(access, SLIDES_API), calendarClient(access, DRIVE_API), {
      title: THANK_YOU_TITLE,
      folderId: THANK_YOU_FOLDER_ID,
      judges: people,
      shareWith,
    });
    return { ok: true, url: deck.url, judges: people.length, withPhotos: people.length };
  } catch (err) {
    if (err instanceof GoogleError && err.revoked) {
      return { ok: false, error: "google_reconnect", message: `Google no longer accepts ${connection.email}'s token. Connect the account again.` };
    }
    return { ok: false, error: "failed", message: (err as Error).message };
  }
}
