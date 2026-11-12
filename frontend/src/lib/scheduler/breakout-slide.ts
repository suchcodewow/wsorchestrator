/**
 * The Scheduler's Show Breakout Slide: one Google Slides slide naming a
 * breakout, with a card for each of its instructors giving their room and the
 * attendees assigned to them. It is made, filed and shared as the guest judges'
 * thank-you slide is (`generateThankYou`): by the Google account connected for
 * Google Meetings, in the same Drive folder, shared with whoever asked, and a
 * slide already there by the same title is trashed first.
 */

import "server-only";

import { GoogleError } from "@/lib/google-calendar";
import { breakoutRequests, createSlideDeck, type BreakoutColumn } from "@/lib/google-slides";
import { googleSlidesConnection, openSlidesClients, revoked } from "@/lib/google-slides-access";
import { THANK_YOU_FOLDER_ID } from "@/lib/logistics/thank-you";
import { roomsOf } from "@/lib/scheduler/facilities";
import { groupsOf } from "@/lib/scheduler/groups";
import { getSession, scheduleBootcamp } from "@/lib/scheduler/schedule";

export type BreakoutSlideResult =
  | { ok: true; url: string; instructors: number; attendees: number }
  | {
      ok: false;
      error: "google_not_configured" | "google_not_connected" | "google_reconnect" | "not_found" | "not_breakout" | "failed";
      message: string;
    };

/** A deck's Drive title is the session's name, so each breakout keeps a slide of its own. */
const titleOf = (name: string) => `Breakout - ${name}`;

/** The columns of a breakout's slide: its leader first, then the other instructors, each with their room and their group. */
export async function breakoutColumns(
  bootcampId: string,
  sessionId: string,
): Promise<{ name: string; columns: BreakoutColumn[] } | "not_found" | "not_breakout"> {
  const session = await getSession(bootcampId, sessionId);
  if (!session) return "not_found";
  if (session.kind !== "breakout") return "not_breakout";
  const bootcamp = await scheduleBootcamp(bootcampId);
  const rooms = new Map((bootcamp?.facilityId ? await roomsOf(bootcamp.facilityId) : []).map((r) => [r.id, r.name]));
  const groups = await groupsOf(sessionId);
  const columns = session.staff.map((p) => ({
    leader: p.fullName,
    room: (p.roomId && rooms.get(p.roomId)) || null,
    people: groups.filter((g) => g.instructorEmail === p.email).map((g) => g.fullName || g.email),
  }));
  return { name: session.name, columns };
}

export async function generateBreakoutSlide(bootcampId: string, sessionId: string, shareWith: string): Promise<BreakoutSlideResult> {
  const google = await googleSlidesConnection();
  if (!google.ok) return google;
  const { client, connection } = google;

  const found = await breakoutColumns(bootcampId, sessionId);
  if (found === "not_found") return { ok: false, error: "not_found", message: "That session no longer exists." };
  if (found === "not_breakout") return { ok: false, error: "not_breakout", message: "That session is not a breakout." };

  try {
    const clients = await openSlidesClients(client, connection);
    if (!clients.ok) return clients;
    const deck = await createSlideDeck(clients.slides, clients.drive, {
      title: titleOf(found.name),
      folderId: THANK_YOU_FOLDER_ID,
      shareWith,
      requests: (starter) => breakoutRequests(starter, found.name, found.columns),
    });
    return {
      ok: true,
      url: deck.url,
      instructors: found.columns.length,
      attendees: found.columns.reduce((n, c) => n + c.people.length, 0),
    };
  } catch (err) {
    if (err instanceof GoogleError && err.revoked) return revoked(connection);
    return { ok: false, error: "failed", message: (err as Error).message };
  }
}
