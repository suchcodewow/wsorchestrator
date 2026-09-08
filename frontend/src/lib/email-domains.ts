/** Reads and matches email domains. */

const DOMAIN_RE =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export function normalizeDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const domain = trimmed.slice(trimmed.lastIndexOf("@") + 1);
  const bare = domain.replace(/\.$/, "");
  return DOMAIN_RE.test(bare) ? bare : null;
}

export function parseDomainList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map(normalizeDomain)
    .filter((d): d is string => d !== null);
}

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
