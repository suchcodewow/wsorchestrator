/** The External Connectors tab: the Google, Zoom and Slack accounts the app acts as. */

import { googleConnectionStatus } from "@/lib/evals/google-meetings";
import { oauthClient } from "@/lib/google-calendar";
import { envSlackToken } from "@/lib/slack";
import { getSlackInstallation, slackApp } from "@/lib/slack-app";
import { zoomApp } from "@/lib/zoom";
import { zoomConnectionStatus } from "@/lib/zoom-connection";
import { ConnectorsView } from "./connectors-view";

export default async function ConnectorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : null);
  const [google, zoom, slack] = await Promise.all([googleConnectionStatus(), zoomConnectionStatus(), getSlackInstallation()]);

  return (
    <ConnectorsView
      google={{ configured: oauthClient() !== null, connection: google && { email: google.email, connectedBy: google.connectedBy, connectedAt: google.connectedAt.toISOString() } }}
      zoom={{ configured: zoomApp() !== null, connection: zoom && { ...zoom, connectedAt: zoom.connectedAt.toISOString() } }}
      slack={{
        appConfigured: slackApp() !== null,
        envToken: Boolean(envSlackToken()),
        installation: slack && { ...slack, installedAt: slack.installedAt.toISOString() },
      }}
      returned={{ google: one("google"), zoom: one("zoom"), slack: one("slack"), current: one("current"), detail: one("detail") }}
    />
  );
}
