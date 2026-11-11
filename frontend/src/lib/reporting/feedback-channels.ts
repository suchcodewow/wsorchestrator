/**
 * The Slack button on a Reporting → Live Sessions card: a private channel per
 * attendee, `event-feedback-{first}-{last}`, where the people who may see the
 * card talk about them. Each press finds the attendee's channel, unarchiving
 * it or making it when it has to, brings its members in line, posts a link
 * back to the card with its scorecard, and says how to open it.
 *
 * It invites everyone above the attendee in HiBob's reporting lines (whoever
 * may see the card as their manager), whoever pressed the button, and the
 * Additional Slack Contacts. Someone the app invited who no longer belongs is
 * taken out; someone added by hand never is. The attendee is never invited
 * to their own channel.
 *
 * While Slack is in dry run (Admin Settings → External Connectors) a press
 * changes nothing and says so.
 */

import "server-only";

import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, feedbackChannels, slackChannelMembers, users } from "@/db/schema";
import { planMembership } from "@/lib/cohorts/slack-plan";
import { slackContactEmails } from "@/lib/evals/slack-contacts";
import { channelMembers, getSlackSyncLive, isFatal, resolveSlackUsers } from "@/lib/cohorts/slack-sync";
import { canReach, getBootcampPerson, nameOf, resolvePerson, type BootcampReader } from "@/lib/reporting/bootcamp";
import { feedbackChannelName, feedbackChannelText } from "@/lib/reporting/feedback-channel-values";
import { SlackError, SlackOutOfTime, slackClient, slackToken, type SlackClient } from "@/lib/slack";
import { getSlackInstallation } from "@/lib/slack-app";

/** How long one press may wait on Slack. */
const DEADLINE_MS = 60_000;
/** How many numbered names to try before giving up on one Slack keeps refusing. */
const NAME_TRIES = 20;

/* ------------------------------------------------------------------ */
/* Who belongs                                                         */
/* ------------------------------------------------------------------ */

/** Everyone above `email` in HiBob's reporting lines, nearest first; `union` stops a loop. */
async function managersOf(email: string): Promise<string[]> {
  const { rows } = await db.execute<{ email: string }>(sql`
    with recursive line(email, depth) as (
      select e.reports_to_email, 1 from ${employees} e
       where e.email = ${email} and e.active and e.reports_to_email <> ''
      union
      select m.reports_to_email, line.depth + 1 from ${employees} m join line on m.email = line.email
       where m.active and m.reports_to_email <> '' and line.depth < 50
    )
    select email from line group by email order by min(depth)`);
  return rows.map((r) => r.email);
}

/* ------------------------------------------------------------------ */
/* The channel                                                         */
/* ------------------------------------------------------------------ */

type Found = { id: string; name: string; created: boolean; unarchived: boolean };

/** The attendee's channel, the bot in it: the one on record, unarchived if it must be, else a new one. */
async function ensureChannel(slack: SlackClient, attendee: { email: string; fullName: string | null }, actorId: string): Promise<Found> {
  const [row] = await db.select().from(feedbackChannels).where(eq(feedbackChannels.attendeeEmail, attendee.email));
  if (row) {
    try {
      const { channel } = await slack.call<{ channel: { is_archived?: boolean } }>("conversations.info", {
        channel: row.slackChannelId,
      });
      if (!channel.is_archived) return { id: row.slackChannelId, name: row.name, created: false, unarchived: false };
      await slack.call("conversations.unarchive", { channel: row.slackChannelId });
      return { id: row.slackChannelId, name: row.name, created: false, unarchived: true };
    } catch (err) {
      // Deleted, or the bot was taken out of it: make another.
      if (!(err instanceof SlackError) || !["channel_not_found", "not_in_channel"].includes(err.error)) throw err;
      await db.delete(feedbackChannels).where(eq(feedbackChannels.attendeeEmail, attendee.email));
    }
  }

  // Names other attendees' channels already have are skipped without asking Slack.
  const base = feedbackChannelName(attendee.fullName, attendee.email);
  const taken = new Set(
    (
      await db
        .select({ name: feedbackChannels.name })
        .from(feedbackChannels)
        .where(like(feedbackChannels.name, `${base}%`))
    ).map((r) => r.name),
  );
  for (let n = 1, tries = 0; tries < NAME_TRIES; n++) {
    const name = feedbackChannelName(attendee.fullName, attendee.email, n);
    if (taken.has(name)) continue;
    tries++;
    let id: string;
    try {
      ({
        channel: { id },
      } = await slack.call<{ channel: { id: string } }>("conversations.create", {
        name,
        is_private: "true",
      }));
    } catch (err) {
      if (err instanceof SlackError && err.error === "name_taken") continue;
      throw err;
    }
    const [saved] = await db
      .insert(feedbackChannels)
      .values({ attendeeEmail: attendee.email, name, slackChannelId: id, createdBy: actorId })
      .onConflictDoNothing()
      .returning({ id: feedbackChannels.slackChannelId });
    if (saved) return { id, name, created: true, unarchived: false };
    // Another press made one first: use that, and put this one away.
    await slack.call("conversations.archive", { channel: id }).catch(() => undefined);
    return ensureChannel(slack, attendee, actorId);
  }
  throw new SlackError("conversations.create", "name_taken");
}

/* ------------------------------------------------------------------ */
/* A press                                                             */
/* ------------------------------------------------------------------ */

export type FeedbackChannelError = "not_found" | "dry_run" | "not_configured" | "slack_error";

export const STATUS_FOR: Record<FeedbackChannelError, number> = {
  not_found: 404,
  dry_run: 409,
  not_configured: 409,
  slack_error: 502,
};

export type FeedbackChannelResult = {
  channelId: string;
  name: string;
  created: boolean;
  unarchived: boolean;
  /** Emails newly invited, and taken out. */
  invited: string[];
  removed: string[];
  /** Emails that belong but have no Slack account, or that Slack would not invite. */
  skipped: string[];
  /** Whether whoever pressed is in the channel after this press. */
  callerIn: boolean;
  /** Opens the channel in the Slack app, and in a browser. */
  appUrl: string;
  webUrl: string;
};

/**
 * One press of the card's button by `caller`, who must be able to see the
 * card. `cardUrl` is the card's own address, posted in the channel.
 */
export async function openFeedbackChannel(
  caller: { id: string; email: string | null },
  reader: BootcampReader,
  key: string,
  cardUrl: string,
): Promise<
  | { ok: true; result: FeedbackChannelResult; attendee: { email: string; fullName: string | null } }
  | { ok: false; error: FeedbackChannelError; detail?: string }
> {
  const email = await resolvePerson(key);
  if (!email || !(await canReach(reader, email))) return { ok: false, error: "not_found" };

  if (!(await getSlackSyncLive())) return { ok: false, error: "dry_run" };
  const [token, install] = await Promise.all([slackToken(), getSlackInstallation()]);
  if (!token) return { ok: false, error: "not_configured" };
  const slack = slackClient(token, Date.now() + DEADLINE_MS);

  const [{ rows: named }, [presser]] = await Promise.all([
    db.execute<{ fullName: string | null }>(sql`select ${nameOf(sql`${email}`)} as "fullName"`),
    db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, caller.id)),
  ]);
  const attendee = { email, fullName: named[0]?.fullName ?? null };
  const callerEmail = caller.email?.trim().toLowerCase() || null;

  const contacts = await slackContactEmails();
  const wantedEmails = [...new Set([...(await managersOf(email)), ...(callerEmail ? [callerEmail] : []), ...contacts])].filter(
    (e) => e !== email,
  );

  try {
    // Whoever pressed is looked up too, to say whether they can open the channel.
    const ids = await resolveSlackUsers(slack, [...new Set([...wantedEmails, ...(callerEmail ? [callerEmail] : [])])]);
    const wanted = new Map<string, string>();
    const skipped: string[] = [];
    for (const e of wantedEmails) {
      const id = ids.get(e);
      if (id) wanted.set(id, e);
      else skipped.push(e);
    }

    const channel = await ensureChannel(slack, attendee, caller.id);
    const [members, invitedRows] = await Promise.all([
      channelMembers(slack, channel.id),
      db.select().from(slackChannelMembers).where(eq(slackChannelMembers.slackChannelId, channel.id)),
    ]);
    const invitedByApp = new Map(invitedRows.map((r) => [r.slackUserId, r.email]));
    const plan = planMembership({
      wanted: new Set(wanted.keys()),
      members,
      invitedBySync: new Set(invitedByApp.keys()),
    });
    const emailOf = (id: string) => wanted.get(id) ?? invitedByApp.get(id) ?? "";

    const gone = [...invitedByApp.keys()].filter((id) => !members.has(id));
    if (gone.length > 0) {
      await db
        .delete(slackChannelMembers)
        .where(and(eq(slackChannelMembers.slackChannelId, channel.id), inArray(slackChannelMembers.slackUserId, gone)));
    }

    const invited: string[] = [];
    if (plan.invite.length > 0) {
      const refused = new Set<string>();
      try {
        await slack.call("conversations.invite", { channel: channel.id, users: plan.invite.join(","), force: "true" });
      } catch (err) {
        if (!(err instanceof SlackError) || isFatal(err)) throw err;
        // With force, Slack invites the rest and names each it refused.
        const errors = Array.isArray(err.body?.errors) ? (err.body.errors as { user?: string; error?: string }[]) : [];
        if (errors.some((e) => e.user)) {
          for (const e of errors) if (e.user && e.error !== "already_in_channel") refused.add(e.user);
        } else {
          for (const id of plan.invite) refused.add(id);
        }
      }
      const added = plan.invite.filter((id) => !refused.has(id));
      if (added.length > 0) {
        await db
          .insert(slackChannelMembers)
          .values(added.map((id) => ({ slackChannelId: channel.id, slackUserId: id, email: emailOf(id) })))
          .onConflictDoNothing();
      }
      invited.push(...added.map(emailOf));
      skipped.push(...[...refused].map(emailOf));
      for (const id of added) members.add(id);
    }

    const removed: string[] = [];
    for (const id of plan.remove) {
      try {
        await slack.call("conversations.kick", { channel: channel.id, user: id });
      } catch (err) {
        if (!(err instanceof SlackError) || isFatal(err)) throw err;
        if (err.error !== "not_in_channel") continue;
      }
      await db
        .delete(slackChannelMembers)
        .where(and(eq(slackChannelMembers.slackChannelId, channel.id), eq(slackChannelMembers.slackUserId, id)));
      removed.push(emailOf(id));
      members.delete(id);
    }

    const who = presser?.name || presser?.email || "Someone";
    const about = attendee.fullName ?? attendee.email;
    // The furthest class they have been to, as the caller sees it on the card.
    const classes = (await getBootcampPerson(reader, key))?.classes;
    const stage = classes?.intermediate.date ? "intermediate" : classes?.bootcamp.date ? "bootcamp" : null;
    await slack.call("chat.postMessage", {
      channel: channel.id,
      text: feedbackChannelText(who, about, cardUrl, stage && classes ? { stage, summary: classes[stage] } : null),
      unfurl_links: "false",
    });

    const callerSlackId = callerEmail ? ids.get(callerEmail) : null;
    const team = install?.teamId ?? "";
    return {
      ok: true,
      attendee,
      result: {
        channelId: channel.id,
        name: channel.name,
        created: channel.created,
        unarchived: channel.unarchived,
        invited: invited.sort(),
        removed: removed.sort(),
        skipped: [...new Set(skipped)].sort(),
        callerIn: callerSlackId ? members.has(callerSlackId) : false,
        appUrl: `slack://channel?team=${team}&id=${channel.id}`,
        webUrl: `https://app.slack.com/client/${team}/${channel.id}`,
      },
    };
  } catch (err) {
    if (err instanceof SlackError || err instanceof SlackOutOfTime) {
      return { ok: false, error: "slack_error", detail: err.message };
    }
    throw err;
  }
}
