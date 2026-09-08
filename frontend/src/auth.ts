/** Auth.js configuration: Google sign-in, the session, and who is let in. */

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
  type SiteRole,
} from "@/db/schema";
import {
  effectiveAllowedDomains,
  isEmailAllowed,
} from "@/lib/allowed-domains";
import { bootstrapAdminEmails, isBootstrapAdmin } from "@/lib/site-admins";

async function applyBootstrapAdmin(email: string | null | undefined) {
  if (!email || !isBootstrapAdmin(email)) return;

  await db
    .update(users)
    .set({ siteRole: "administrator" })
    .where(and(eq(users.email, email), ne(users.siteRole, "administrator")));
}

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
    signIn({ user }) {
      return applyBootstrapAdmin(user.email);
    },
  },
  callbacks: {
    signIn({ user, profile }) {
      if (profile && profile.email_verified === false) return false;
      return isEmailAllowed(user.email ?? profile?.email);
    },

    async session({ session, user }) {
      if (!session.user) return session;
      session.user.id = user.id;
      let role = (user as { siteRole?: SiteRole }).siteRole ?? "operator";

      if (role !== "administrator" && isBootstrapAdmin(session.user.email)) {
        await db
          .update(users)
          .set({ siteRole: "administrator" })
          .where(eq(users.id, user.id));
        role = "administrator";
      }

      session.user.siteRole = role;
      return session;
    },
  },
});

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
