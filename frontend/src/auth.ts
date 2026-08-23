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
      // No `hd` here: the allowed domains live in the database now, and a
      // provider is configured once at module load. The sign-in page passes it
      // per request instead — see `googleHostedDomain` below.
    }),
  ],
  pages: {
    signIn: "/signin",
    // A rejected domain raises AccessDenied, which Auth.js sends to the error
    // page. Point that at our own sign-in page so a turned-away visitor gets
    // the branded page and a reason, not the framework's default screen.
    error: "/signin",
  },
  events: {
    signIn({ user }) {
      return applyBootstrapAdmin(user.email);
    },
  },
  callbacks: {
    // The gate on who may sign in at all. Runs before the adapter writes
    // anything, so a rejected address creates no user row and no session —
    // it is refused, not created and then hidden.
    signIn({ user, profile }) {
      // Google states whether it verified the address. An unverified one says
      // nothing about who owns the domain, which is the whole basis for
      // trusting the domain list.
      if (profile && profile.email_verified === false) return false;
      return isEmailAllowed(user.email ?? profile?.email);
    },

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

/**
 * Bootstrap emails that have no user row yet — nobody has signed in with them.
 * Surfaced on the users page so a typo in `SITE_ADMIN_EMAILS` looks like a
 * typo rather than like the setting being ignored.
 */
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

/**
 * The `hd` parameter to send Google with the authorization request, or null.
 *
 * With exactly one allowed domain, Google offers that Workspace's accounts
 * instead of letting someone pick a personal account and be turned away after
 * the round trip. With none or several there is nothing to narrow to — `hd`
 * takes one domain — so the ordinary chooser is right.
 *
 * A hint in a URL the visitor controls, never the check: `callbacks.signIn`
 * above is what enforces the list, on the value Google signs and returns.
 */
export async function googleHostedDomain(): Promise<string | null> {
  const domains = await effectiveAllowedDomains();
  return domains.length === 1 ? domains[0] : null;
}
