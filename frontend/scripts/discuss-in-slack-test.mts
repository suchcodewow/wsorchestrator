/**
 * A test of the "Discuss in Slack" button on a Live Sessions card that only
 * you see: it posts the button's message, scorecard and all, for one attendee,
 * but in a channel of its own with you as its only member. The attendee's
 * managers and the Additional Slack Contacts are not invited, nobody is taken
 * out, and the attendee's real channel (`feedback_channels`) is not touched.
 *
 *   npx tsx --conditions=react-server scripts/discuss-in-slack-test.mts <attendee> <your email> [--dry-run]
 *
 * `<attendee>` is their employee id, as in /reporting/bootcamp/{key}, or
 * their email. Run from frontend/ with `DATABASE_URL` and `AUTH_SECRET` for
 * the deployment whose scorecards and Slack install it should use
 * (`slackToken()`: the install, else `SLACK_BOT_TOKEN`). The card link is
 * built from `AUTH_URL`, else http://localhost:3000.
 *
 * The channel is the attendee's usual name with `-test` after it. Each run
 * reuses it, unarchiving it if need be, and posts once more; archive it in
 * Slack when you are done. `--dry-run` prints the channel and the message
 * without calling Slack.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, evalsSubmissions, users } from "@/db/schema";
import { getBootcampPerson, nameOf, resolvePerson } from "@/lib/reporting/bootcamp";
import { feedbackChannelName, feedbackChannelText } from "@/lib/reporting/feedback-channel-values";
import { slackClient, slackToken, SlackError, type SlackClient } from "@/lib/slack";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [attendeeArg, meArg] = args.filter((a) => !a.startsWith("--"));
if (!attendeeArg || !meArg) {
  console.error("Usage: scripts/discuss-in-slack-test.mts <attendee key or email> <your email> [--dry-run]");
  process.exit(2);
}
const me = meArg.trim().toLowerCase();

/** The card's key for `arg`: itself when it is one, else the employee or a submission with that email. */
async function keyFor(arg: string): Promise<string> {
  if (!arg.includes("@")) return arg;
  const [employee] = await db.select({ id: employees.id }).from(employees).where(eq(employees.email, arg)).limit(1);
  if (employee) return employee.id;
  const [submission] = await db
    .select({ id: evalsSubmissions.id })
    .from(evalsSubmissions)
    .where(eq(evalsSubmissions.attendeeEmail, arg))
    .limit(1);
  return submission?.id ?? arg;
}

// What the button would post, as the card shows it to someone who may see everyone.
const key = await keyFor(attendeeArg.trim().toLowerCase());
const email = await resolvePerson(key);
const person = email ? await getBootcampPerson({ all: true, email: me, id: null }, key) : null;
if (!email || !person) {
  console.error(`No Live Sessions person ${attendeeArg} in this database.`);
  process.exit(1);
}
const [{ rows: named }, [presser]] = await Promise.all([
  db.execute<{ fullName: string | null }>(sql`select ${nameOf(sql`${email}`)} as "fullName"`),
  db.select({ name: users.name }).from(users).where(eq(users.email, me)).limit(1),
]);
const fullName = named[0]?.fullName ?? null;
const { classes } = person;
const stage = classes.intermediate.date ? "intermediate" : classes.bootcamp.date ? "bootcamp" : null;
const cardUrl = `${process.env.AUTH_URL ?? "http://localhost:3000"}/reporting/bootcamp/${encodeURIComponent(person.key)}`;
const text = feedbackChannelText(
  presser?.name || me,
  fullName ?? email,
  cardUrl,
  stage ? { stage, summary: classes[stage] } : null,
);
const name = `${feedbackChannelName(fullName, email).slice(0, 75)}-test`;

console.log(`Attendee: ${fullName ?? "(no name)"} <${email}>, ${stage ?? "no class attended"}`);
console.log(`Channel:  #${name}, inviting only ${me}`);
console.log(`Message:\n${text}\n`);
if (dryRun) process.exit(0);

const token = await slackToken();
if (!token) {
  console.error("No Slack token: no install this deployment can open, and no SLACK_BOT_TOKEN.");
  process.exit(1);
}
const slack = slackClient(token, Date.now() + 60_000);

/** The test channel the bot made on an earlier run, if Slack still has it. */
async function findChannel(client: SlackClient): Promise<{ id: string; is_archived?: boolean } | null> {
  let cursor = "";
  do {
    const page = await client.call<{
      channels: { id: string; name: string; is_archived?: boolean }[];
      response_metadata?: { next_cursor?: string };
    }>("conversations.list", { types: "private_channel", exclude_archived: "false", limit: "200", cursor });
    const hit = page.channels.find((c) => c.name === name);
    if (hit) return hit;
    cursor = page.response_metadata?.next_cursor ?? "";
  } while (cursor);
  return null;
}

try {
  const auth = await slack.call<{ team_id: string }>("auth.test", {});
  const { user } = await slack.call<{ user: { id: string } }>("users.lookupByEmail", { email: me });

  let channel: { id: string; is_archived?: boolean } | null = null;
  try {
    ({ channel } = await slack.call<{ channel: { id: string } }>("conversations.create", { name, is_private: "true" }));
    console.log(`Created #${name}`);
  } catch (err) {
    if (!(err instanceof SlackError) || err.error !== "name_taken") throw err;
    channel = await findChannel(slack);
    if (!channel) throw new Error(`#${name} exists but the bot is not in it. Archive or rename it in Slack, then run again.`);
    if (channel.is_archived) {
      await slack.call("conversations.unarchive", { channel: channel.id });
      console.log(`Unarchived #${name}`);
    } else console.log(`Reusing #${name}`);
  }

  try {
    await slack.call("conversations.invite", { channel: channel.id, users: user.id });
    console.log(`Invited ${me}`);
  } catch (err) {
    if (!(err instanceof SlackError) || err.error !== "already_in_channel") throw err;
  }

  await slack.call("chat.postMessage", { channel: channel.id, text, unfurl_links: "false" });
  console.log(`Posted. Open it: slack://channel?team=${auth.team_id}&id=${channel.id}`);
} catch (err) {
  if (err instanceof SlackError) console.error(err.message);
  else throw err;
  process.exit(1);
}
process.exit(0);
