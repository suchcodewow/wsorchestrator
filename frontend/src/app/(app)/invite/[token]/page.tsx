/**
 * Where an invite link lands. The signed-in shell has already sent a
 * signed-out visitor through sign-in and back, so the sign-in domain limit
 * applies before this page is reached.
 *
 * Taking the invite up is a button rather than something the page does on
 * load, so a link preview or a prefetch can never spend it.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import {
  EVALS_ROLE_LABELS,
  EVENT_ROLE_LABELS,
  IRIS_ROLE_LABELS,
  TRAINING_ROLE_LABELS,
  hasNoAccess,
  homePath,
} from "@/lib/roles";
import { readInvite, type InviteGrant } from "@/lib/user-invites";
import { InviteView } from "./invite-view";

export const metadata: Metadata = {
  title: "Invite",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function grantLabels(grant: InviteGrant): string[] {
  return [
    ...(grant.eventRole ? [EVENT_ROLE_LABELS[grant.eventRole]] : []),
    ...(grant.trainingRole ? [TRAINING_ROLE_LABELS[grant.trainingRole]] : []),
    ...(grant.evalsRole ? [EVALS_ROLE_LABELS[grant.evalsRole]] : []),
    ...(grant.irisRole ? [IRIS_ROLE_LABELS[grant.irisRole]] : []),
  ];
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const { token } = await params;
  const read = await readInvite(token);

  return (
    <InviteView
      token={token}
      email={session.user.email ?? ""}
      home={homePath(session.user.access)}
      invite={
        read.ok
          ? {
              roles: grantLabels(read.invite.grant),
              invitedBy: read.invite.invitedBy,
              alreadyHasAccess: !hasNoAccess(session.user.access),
            }
          : { error: read.error }
      }
    />
  );
}
