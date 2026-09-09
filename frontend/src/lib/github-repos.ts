/** Reads and names GitHub repositories. */

import { REPO_LIMITS, type RepoScope } from "@/db/schema";

/** One listed repository, as both the settings page and its API see it. */
export type RepoRow = {
  id: string;
  url: string;
  providerRepo: string;
  identifier: string;
  scope: RepoScope;
  createdAt: string;
  addedBy: string | null;
};

/**
 * `owner/name` from a GitHub URL, or null if it is not one.
 *
 * Deliberately forgiving about the shapes a repository page can be copied in —
 * `https://` or not, `www.` or not, a trailing `.git` from a clone URL, a
 * trailing slash — because all of those are the address bar of the same
 * repository, and refusing them would only teach an administrator to hand-edit
 * what they pasted.
 *
 * Anything deeper than `owner/name` (a link to a file, a branch, a pull request)
 * is rejected rather than truncated: it may well have been meant, and silently
 * importing the whole repository from a link to one file inside it is a guess
 * this has no business making.
 */
export function parseGithubUrl(
  input: string,
): { providerRepo: string; url: string } | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > REPO_LIMITS.url) return null;

  let parsed: URL;
  try {
    parsed = new URL(
      /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  if (host !== "github.com") return null;

  const parts = parsed.pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 2) return null;

  const owner = parts[0]!;
  const name = parts[1]!.replace(/\.git$/i, "");
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) return null;

  return {
    providerRepo: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
  };
}

/** What a Harness Code repository may be called. */
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

export const repoIdentifierValid = (value: string) =>
  IDENTIFIER.test(value.trim());

/**
 * The name to offer for a repository nobody has named yet: the GitHub name
 * without its owner, which is what an administrator would type anyway.
 */
export const suggestedIdentifier = (providerRepo: string) =>
  providerRepo.split("/")[1] ?? "";
