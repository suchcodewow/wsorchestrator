/**
 * Reading the GitHub repository an administrator pasted, and naming its
 * Harness Code copy.
 *
 * Every provision imports these repositories, so what `parseGithubUrl` accepts
 * is what every workshop gets. It is forgiving on purpose about the shapes the
 * same repository's address can be pasted in (scheme or not, `www.`, a `.git`
 * clone suffix, a trailing slash) and strict on purpose about anything deeper
 * than `owner/name`: a link to one file inside a repository is not a request to
 * import the whole thing, and silently truncating it would be a guess. It must
 * also refuse anything that is not github.com, however much it looks like it.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { REPO_LIMITS } from "@/db/schema";
import { parseGithubUrl, repoIdentifierValid, suggestedIdentifier } from "@/lib/github-repos";

const HELLO = {
  providerRepo: "octocat/Hello-World",
  url: "https://github.com/octocat/Hello-World",
};

describe("parseGithubUrl", () => {
  test("accepts every way the same repository's address is pasted", () => {
    for (const input of [
      "https://github.com/octocat/Hello-World",
      "http://github.com/octocat/Hello-World",
      "github.com/octocat/Hello-World",
      "www.github.com/octocat/Hello-World",
      "https://www.github.com/octocat/Hello-World",
      "https://github.com/octocat/Hello-World.git",
      "https://github.com/octocat/Hello-World.GIT",
      "https://github.com/octocat/Hello-World/",
      "https://github.com/octocat/Hello-World.git/",
      "HTTPS://GitHub.com/octocat/Hello-World",
      "  https://github.com/octocat/Hello-World \n",
      "https://github.com/octocat/Hello-World?tab=readme-ov-file",
      "https://github.com/octocat/Hello-World#readme",
    ]) {
      assert.deepEqual(parseGithubUrl(input), HELLO, JSON.stringify(input));
    }
  });

  test("always gives back a canonical https URL", () => {
    assert.equal(parseGithubUrl("http://www.github.com/a/b.git")?.url, "https://github.com/a/b");
  });

  test("keeps the owner and name as cased, since that is how GitHub shows them", () => {
    assert.equal(parseGithubUrl("github.com/Harness/Go-Demo")?.providerRepo, "Harness/Go-Demo");
  });

  test("accepts dots, underscores and hyphens in names", () => {
    assert.deepEqual(parseGithubUrl("github.com/my-org/my_repo.v2"), {
      providerRepo: "my-org/my_repo.v2",
      url: "https://github.com/my-org/my_repo.v2",
    });
    assert.equal(parseGithubUrl("github.com/harness/.github")?.providerRepo, "harness/.github");
  });

  test("strips only one trailing .git", () => {
    assert.equal(parseGithubUrl("github.com/a/b.git.git")?.providerRepo, "a/b.git");
  });

  test("rejects anything deeper than owner/name rather than truncating it", () => {
    for (const input of [
      "https://github.com/octocat/Hello-World/blob/main/README.md",
      "https://github.com/octocat/Hello-World/tree/dev",
      "https://github.com/octocat/Hello-World/pull/1",
      "https://github.com/octocat/Hello-World/issues",
    ]) {
      assert.equal(parseGithubUrl(input), null, input);
    }
  });

  test("rejects anything shallower than owner/name", () => {
    for (const input of ["https://github.com", "https://github.com/", "github.com/octocat", "https://github.com/octocat/"]) {
      assert.equal(parseGithubUrl(input), null, input);
    }
  });

  test("rejects hosts that are not github.com, however close", () => {
    for (const input of [
      "https://gitlab.com/octocat/Hello-World",
      "https://gist.github.com/octocat/abc123",
      "https://api.github.com/octocat/Hello-World",
      "https://github.com.evil.example/octocat/Hello-World",
      "https://evilgithub.com/octocat/Hello-World",
      "https://github.com@evil.example/octocat/Hello-World",
      "https://raw.githubusercontent.com/octocat/Hello-World",
      "https://github.co/octocat/Hello-World",
    ]) {
      assert.equal(parseGithubUrl(input), null, input);
    }
  });

  test("rejects schemes other than http and https", () => {
    for (const input of [
      "ftp://github.com/octocat/Hello-World",
      "ssh://git@github.com/octocat/Hello-World.git",
      "git://github.com/octocat/Hello-World.git",
      "file://github.com/octocat/Hello-World",
    ]) {
      assert.equal(parseGithubUrl(input), null, input);
    }
  });

  test("rejects the scp-style clone address rather than misreading it", () => {
    assert.equal(parseGithubUrl("git@github.com:octocat/Hello-World.git"), null);
  });

  test("rejects names with characters GitHub does not allow", () => {
    for (const input of [
      "github.com/octo%20cat/Hello-World",
      "github.com/octocat/Hello%20World",
      "github.com/octocat/Hello~World",
      "github.com/octocat/.git",
    ]) {
      assert.equal(parseGithubUrl(input), null, input);
    }
  });

  test("rejects empty, blank and unparseable input", () => {
    for (const input of ["", "   ", "not a url", "https://", "://github.com/a/b"]) {
      assert.equal(parseGithubUrl(input), null, JSON.stringify(input));
    }
  });

  test("accepts an address exactly at the length limit and not one past it", () => {
    const prefix = "https://github.com/o/";
    const atLimit = prefix + "r".repeat(REPO_LIMITS.url - prefix.length);
    assert.equal(atLimit.length, REPO_LIMITS.url);
    assert.notEqual(parseGithubUrl(atLimit), null);
    assert.equal(parseGithubUrl(`${atLimit}r`), null);
  });

  test("measures the limit after trimming surrounding whitespace", () => {
    const prefix = "https://github.com/o/";
    const atLimit = prefix + "r".repeat(REPO_LIMITS.url - prefix.length);
    assert.notEqual(parseGithubUrl(`   ${atLimit}   `), null);
  });
});

describe("repoIdentifierValid", () => {
  test("accepts names that start with a letter or digit", () => {
    for (const ok of ["a", "Z", "0", "demo", "go-demo", "my_repo.v2", "9lives", "A1-b_c.d"]) {
      assert.equal(repoIdentifierValid(ok), true, ok);
    }
  });

  test("ignores surrounding whitespace", () => {
    assert.equal(repoIdentifierValid("  demo  "), true);
  });

  test("rejects a leading separator, spaces inside, or other punctuation", () => {
    for (const bad of ["", "   ", "-demo", ".github", "_repo", "my repo", "a/b", "a@b", "ümlaut", "a$b"]) {
      assert.equal(repoIdentifierValid(bad), false, JSON.stringify(bad));
    }
  });

  test("allows up to the identifier limit and no more", () => {
    assert.equal(REPO_LIMITS.identifier, 100);
    assert.equal(repoIdentifierValid("a".repeat(REPO_LIMITS.identifier)), true);
    assert.equal(repoIdentifierValid("a".repeat(REPO_LIMITS.identifier + 1)), false);
  });
});

describe("suggestedIdentifier", () => {
  test("is the repository name without its owner", () => {
    assert.equal(suggestedIdentifier("octocat/Hello-World"), "Hello-World");
    assert.equal(suggestedIdentifier(parseGithubUrl("github.com/a/b.git")!.providerRepo), "b");
  });

  test("is empty for something that is not owner/name", () => {
    assert.equal(suggestedIdentifier("no-slash"), "");
    assert.equal(suggestedIdentifier(""), "");
  });

  test("is a valid identifier for an ordinary repository name", () => {
    for (const repo of ["harness/go-demo", "octocat/Hello-World", "a/my_repo.v2"]) {
      assert.equal(repoIdentifierValid(suggestedIdentifier(repo)), true, repo);
    }
  });

  test("passes a name Harness cannot use through unchanged, for the person to rename", () => {
    // `.github` is a real and common repository name. The suggestion is just
    // the GitHub name; `check` in harness-repos refuses it as
    // invalid_identifier, so the administrator is asked for one rather than
    // given a silently different name.
    assert.equal(suggestedIdentifier("harness/.github"), ".github");
    assert.equal(repoIdentifierValid(".github"), false);
  });
});
