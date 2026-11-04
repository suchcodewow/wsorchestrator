/**
 * A one-off test of what the "Slack message" button on a Live Sessions person
 * would do: create a private channel as the bot, invite people by email, and
 * post a link. It uses the same token the channel sync does (`slackToken()`:
 * the app's install, else `SLACK_BOT_TOKEN`), so it shows whether that token
 * was granted `groups:write`. Slack names any missing scope in its answer.
 *
 *   npx tsx --conditions=react-server scripts/slack-private-channel-test.mts shawn.pearson@harness.io [more emails…]
 *
 * Run from frontend/ with `DATABASE_URL` and `AUTH_SECRET` for the deployment
 * whose install it should use, or `SLACK_BOT_TOKEN` set. It creates a real
 * channel; archive it in Slack afterwards.
 */

import { slackClient, slackToken, SlackError } from "@/lib/slack";

const emails = process.argv.slice(2).map((e) => e.trim().toLowerCase()).filter(Boolean);
if (emails.length === 0) {
  console.error("Usage: scripts/slack-private-channel-test.mts <email> [email…]");
  process.exit(2);
}

const token = await slackToken();
if (!token) {
  console.error("No Slack token: no install this deployment can open, and no SLACK_BOT_TOKEN.");
  process.exit(1);
}
const slack = slackClient(token, Date.now() + 60_000);

try {
  const auth = await slack.call<{ team_id: string; user_id: string }>("auth.test", {});
  console.log(`Bot ${auth.user_id} in team ${auth.team_id}`);

  const ids: string[] = [];
  for (const email of emails) {
    try {
      const { user } = await slack.call<{ user: { id: string } }>("users.lookupByEmail", { email });
      ids.push(user.id);
      console.log(`${email} → ${user.id}`);
    } catch (err) {
      console.warn(`${email}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (ids.length === 0) throw new Error("Nobody to invite.");

  // Channel names are unique for good, archived ones included, so the test stamps its own.
  const name = `mgr-test-${new Date().toISOString().slice(0, 16).replace(/\D/g, "")}`;
  const { channel } = await slack.call<{ channel: { id: string; name: string } }>("conversations.create", {
    name,
    is_private: "true",
  });
  console.log(`Created private #${channel.name} (${channel.id})`);

  await slack.call("conversations.invite", { channel: channel.id, users: ids.join(",") });
  console.log(`Invited ${ids.length}`);

  const link = `${process.env.AUTH_URL ?? "http://localhost:3000"}/reporting/bootcamp`;
  await slack.call("chat.postMessage", {
    channel: channel.id,
    text: `Test of the Live Sessions "Slack message" button. The card it would link to: ${link}`,
  });
  console.log(`Posted. Open it: slack://channel?team=${auth.team_id}&id=${channel.id}`);
} catch (err) {
  if (err instanceof SlackError) console.error(err.message);
  else throw err;
  process.exit(1);
}
