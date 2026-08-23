/**
 * The bootstrap administrators, from `SITE_ADMIN_EMAILS` (comma or whitespace
 * separated).
 *
 * Roles are granted by an administrator, so a fresh database — where everyone
 * is an operator — needs one that comes from outside the app. The same list
 * doubles as the way back in when the sign-in domains are configured wrongly:
 * these addresses are allowed whatever their domain (see
 * `@/lib/allowed-domains`), so a mis-typed domain cannot lock the site's
 * administrators out of the page that would fix it.
 *
 * Read at call time rather than at import: on Cloud Run the value arrives in
 * the environment, and a deploy that adds one should take effect without the
 * module being re-evaluated.
 */
export function bootstrapAdminEmails(): string[] {
  return (process.env.SITE_ADMIN_EMAILS ?? "")
    .split(/[\s,]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isBootstrapAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return bootstrapAdminEmails().includes(email.trim().toLowerCase());
}
