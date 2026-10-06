/** Auth.js configuration: Google sign-in, the session, and who is let in. */

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { headers } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
  type EvalsRole,
  type EventRole,
  type IrisRole,
  type TrainingRole,
} from "@/db/schema";
import {
  effectiveAllowedDomains,
  isEmailAllowed,
} from "@/lib/allowed-domains";
import { recordAudit, requestIp } from "@/lib/audit";
import { googlePhotoChosen, syncGoogleProfile } from "@/lib/google-profile";
import { REQUEST_PATH_HEADER, returnPath } from "@/lib/request-path";
import type { Access } from "@/lib/roles";
import { isJudgingNow } from "@/lib/scheduler/judging";
import { bootstrapAdminEmails, isBootstrapAdmin } from "@/lib/site-admins";

/** The bootstrap administrators in SITE_ADMIN_EMAILS are platform administrators. */
async function applyBootstrapAdmin(email: string | null | undefined) {
  if (!email || !isBootstrapAdmin(email)) return;

  await db
    .update(users)
    .set({ isPlatformAdmin: true })
    .where(and(eq(users.email, email), eq(users.isPlatformAdmin, false)));
}

type UserRow = {
  eventRole?: EventRole;
  trainingRole?: TrainingRole | null;
  evalsRole?: EvalsRole | null;
  irisRole?: IrisRole | null;
  isPlatformAdmin?: boolean;
};

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  events: {
    async signIn({ user, account, profile, isNewUser }) {
      const photoChosen = await googlePhotoChosen(account?.access_token);
      await syncGoogleProfile(user.id, profile, photoChosen);
      await applyBootstrapAdmin(user.email);
      if (user.id) {
        await recordAudit({
          actor: { id: user.id, email: user.email ?? null, name: user.name ?? null },
          via: "session",
          action: "auth.sign-in",
          summary: isNewUser ? "Signed in for the first time, creating the account." : "Signed in with Google.",
          outcome: "succeeded",
          ip: await requestIp(),
        });
      }
    },
    async signOut(message) {
      const userId = "session" in message ? message.session?.userId : undefined;
      if (!userId) return;
      await recordAudit({
        actor: { id: userId, email: null },
        via: "session",
        action: "auth.sign-out",
        summary: "Signed out.",
        outcome: "succeeded",
        ip: await requestIp(),
      });
    },
  },
  callbacks: {
    async signIn({ user, profile }) {
      const email = user.email ?? profile?.email ?? null;
      const why =
        profile && profile.email_verified === false
          ? "unverified_email"
          : (await isEmailAllowed(email))
            ? null
            : "domain_not_allowed";
      if (!why) return true;

      await recordAudit({
        actor: null,
        actorName: user.name ?? email ?? undefined,
        via: "anonymous",
        action: "auth.sign-in",
        summary: "Tried to sign in and was refused.",
        target: email,
        status: 403,
        outcome: "denied",
        detail: { error: why },
        ip: await requestIp(),
      });
      return false;
    },

    async session({ session, user }) {
      if (!session.user) return session;
      session.user.id = user.id;
      const row = user as UserRow;
      const access: Access = {
        event: row.eventRole ?? "none",
        training: row.trainingRole ?? null,
        evals: row.evalsRole ?? null,
        iris: row.irisRole ?? null,
        platform: row.isPlatformAdmin ?? false,
        judging: await isJudgingNow(session.user.email),
      };

      if (!access.platform && isBootstrapAdmin(session.user.email)) {
        await db
          .update(users)
          .set({ isPlatformAdmin: true })
          .where(eq(users.id, user.id));
        access.platform = true;
      }

      session.user.access = access;
      return session;
    },
  },
});

/**
 * Where to send a visitor who isn't signed in: the sign-in page, carrying the
 * page they asked for so they land there afterwards.
 */
export async function signInPath(): Promise<string> {
  const asked = returnPath((await headers()).get(REQUEST_PATH_HEADER));
  if (!asked) return "/signin";

  return `/signin?callbackUrl=${encodeURIComponent(asked)}`;
}

export async function pendingBootstrapAdmins(): Promise<string[]> {
  const listed = bootstrapAdminEmails();
  if (listed.length === 0) return [];

  const present = await db
    .select({ email: users.email })
    .from(users)
    .where(inArray(users.email, listed));

  const known = new Set(present.map((r) => r.email?.toLowerCase()));
  return listed.filter((e) => !known.has(e));
}

export async function googleHostedDomain(): Promise<string | null> {
  const domains = await effectiveAllowedDomains();
  return domains.length === 1 ? domains[0] : null;
}
