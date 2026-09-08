/** The bootstrap administrators, from SITE_ADMIN_EMAILS. */

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
