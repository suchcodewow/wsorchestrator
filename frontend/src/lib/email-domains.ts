/**
 * Who may sign in, as pure rules.
 *
 * Deliberately free of the database and the session — the sign-in gate, the
 * settings page's "this would lock you out" guard, and the API validation all
 * decide from the same three functions rather than each re-stating what a
 * domain is. The server is still the only enforcer; see `@/lib/allowed-domains`
 * for the list these are applied to.
 */

/** A bare hostname: labels of letters, digits and inner hyphens, dot-joined. */
const DOMAIN_RE =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Reduce what someone typed to a bare domain, or null if it isn't one.
 *
 * Accepts what people actually paste: `@example.com`, a whole address, mixed
 * case, stray spaces. Everything after the last `@` is taken, so pasting
 * `someone@example.com` adds `example.com` rather than failing validation on a
 * value the person plainly meant as that domain.
 */
export function normalizeDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const domain = trimmed.slice(trimmed.lastIndexOf("@") + 1);
  // A trailing dot is legal in DNS and means the same name; the list stores
  // one spelling, so drop it rather than keeping a second row for it.
  const bare = domain.replace(/\.$/, "");
  return DOMAIN_RE.test(bare) ? bare : null;
}

/** Split a comma or whitespace separated env var into normalized domains. */
export function parseDomainList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map(normalizeDomain)
    .filter((d): d is string => d !== null);
}

/**
 * Whether `email` is allowed by `domains`.
 *
 * An empty list is no restriction rather than a restriction nobody passes —
 * a site that has never configured this stays open, which is what it was
 * before the setting existed.
 *
 * The comparison is exact on the part after the last `@`, so `example.com`
 * admits nothing else: not `sub.example.com`, and — the one that matters —
 * not `example.com.attacker.net`.
 */
export function emailAllowedBy(
  email: string | null | undefined,
  domains: string[],
): boolean {
  if (domains.length === 0) return true;
  if (!email) return false;

  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at < 0) return false;

  return domains.includes(address.slice(at + 1));
}
