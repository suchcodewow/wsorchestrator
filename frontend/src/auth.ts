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

/**
 * Emails that are always administrators, from `SITE_ADMIN_EMAILS` (comma or
 * whitespace separated). This is the bootstrap: roles are granted by an
 * administrator, so a fresh database — where everyone is an operator — needs
 * one that comes from outside the app.
 */
function bootstrapAdmins(): string[] {
  return (process.env.SITE_ADMIN_EMAILS ?? "")
    .split(/[\s,]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Promote a bootstrap email on sign-in, if it isn't already an administrator.
 *
 * Applied at sign-in rather than at every session read so it costs one write
 * on the rare occasion it changes something, and never a query per request.
 * It only ever grants: an administrator demoted through the users page stays
 * demoted until they sign in again, which is the same "listed here means
 * administrator" rule stated once more.
 */
async function applyBootstrapAdmin(email: string | null | undefined) {
  if (!email) return;
  if (!bootstrapAdmins().includes(email.toLowerCase())) return;

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
  },
  events: {
    signIn({ user }) {
      return applyBootstrapAdmin(user.email);
    },
  },
  callbacks: {
    // Expose the user id and role on the session for API/ownership checks.
    //
    // `user` is the whole row the adapter joined to the session, so the role
    // is already in hand and reflects the database on every request — a role
    // change takes effect on the user's next page load, with no re-sign-in.
    async session({ session, user }) {
      if (!session.user) return session;
      session.user.id = user.id;
      let role = (user as { siteRole?: SiteRole }).siteRole ?? "operator";

      // Self-heal the bootstrap here as well as on sign-in: the sign-in event
      // fires once, so an administrator listed in SITE_ADMIN_EMAILS *after*
      // they were already signed in — or before the env var reached this
      // deployment — would otherwise never be promoted. Costs only an in-memory
      // check per request; the write happens at most once, since the guard is
      // false the moment the role already matches.
      if (
        role !== "administrator" &&
        session.user.email &&
        bootstrapAdmins().includes(session.user.email.toLowerCase())
      ) {
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

/**
 * Bootstrap emails that have no user row yet — nobody has signed in with them.
 * Surfaced on the users page so a typo in `SITE_ADMIN_EMAILS` looks like a
 * typo rather than like the setting being ignored.
 */
export async function pendingBootstrapAdmins(): Promise<string[]> {
  const listed = bootstrapAdmins();
  if (listed.length === 0) return [];

  const present = await db
    .select({ email: users.email })
    .from(users)
    .where(inArray(users.email, listed));

  const known = new Set(present.map((r) => r.email?.toLowerCase()));
  return listed.filter((e) => !known.has(e));
}
