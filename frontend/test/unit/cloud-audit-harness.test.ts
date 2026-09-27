/**
 * The Harness audit: which organizations in the account belong to a run, which
 * are the site's own, and which were left behind.
 *
 * The runner tags every org it creates `managed_by: workshop-orchestrator`.
 * An org carrying that tag that no run claims is `untracked` — a teardown that
 * did not finish — and is what the page exists to surface. The account's
 * built-in default org (`harnessManaged`) and anything in `HARNESS_INFRA_ORGS`
 * are `infra`; everything else in the account is someone else's
 * (`unmanaged`) and must never be presented as ours to delete.
 *
 * `fetch` is replaced with canned Harness responses; nothing leaves the
 * process.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { auditHarness } from "@/lib/cloud-audit/harness";
import { json, owner, ownerMaps, withCleanEnv, installFakeFetch } from "../support/cloud-audit";

withCleanEnv(["HARNESS_ACCOUNT_ID", "HARNESS_API_KEY", "HARNESS_BASE_URL", "HARNESS_INFRA_ORGS"]);
const fake = installFakeFetch();

const BASE = "https://harness.test";
const TAG = { managed_by: "workshop-orchestrator" };

type Org = {
  organization?: { identifier?: string; name?: string; tags?: Record<string, string> | null };
  createdAt?: number;
  harnessManaged?: boolean;
};

function configure() {
  process.env.HARNESS_ACCOUNT_ID = "acct123";
  process.env.HARNESS_API_KEY = "pat.test";
  process.env.HARNESS_BASE_URL = `${BASE}/`;
}

/** Serve `pages` of orgs, and the account's name. */
function serve(pages: Org[][], accountName: string | null = "Workshops") {
  fake.route = (url) => {
    if (url.origin !== BASE) return undefined;
    if (url.pathname === "/ng/api/organizations") {
      const page = Number(url.searchParams.get("pageIndex"));
      return json({ data: { content: pages[page] ?? [], totalPages: pages.length } });
    }
    if (url.pathname === "/ng/api/accounts/acct123") {
      return accountName === null ? json({}, 500) : json({ data: { name: accountName } });
    }
    return undefined;
  };
}

const org = (identifier: string, extra: Omit<Org, "organization"> & { tags?: Record<string, string> | null; name?: string } = {}): Org => {
  const { tags, name, ...rest } = extra;
  return { organization: { identifier, name: name ?? identifier, tags: tags ?? {} }, ...rest };
};

async function audit(owners = ownerMaps()) {
  const result = await auditHarness(owners);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result.audit;
}

describe("configuration", () => {
  test("is not_configured without an account id or an API key, and makes no request", async () => {
    assert.deepEqual(await auditHarness(ownerMaps()), { ok: false, error: "not_configured" });
    process.env.HARNESS_ACCOUNT_ID = "acct123";
    assert.deepEqual(await auditHarness(ownerMaps()), { ok: false, error: "not_configured" });
    delete process.env.HARNESS_ACCOUNT_ID;
    process.env.HARNESS_API_KEY = "pat.test";
    assert.deepEqual(await auditHarness(ownerMaps()), { ok: false, error: "not_configured" });
    assert.equal(fake.calls.length, 0);
  });

  test("authenticates with the API key and scopes to the account", async () => {
    configure();
    serve([[]]);
    await audit();
    const list = fake.calls.find((c) => c.url.includes("/ng/api/organizations"))!;
    assert.equal(new URL(list.url).searchParams.get("accountIdentifier"), "acct123");
    assert.equal((list.init?.headers as Record<string, string>)["x-api-key"], "pat.test");
  });
});

describe("classification", () => {
  test("claimed, infrastructure, ours-but-unclaimed, and someone else's", async () => {
    configure();
    process.env.HARNESS_INFRA_ORGS = " site_admin , ,other_infra";
    serve([
      [
        org("wo_run_a", { tags: TAG }),
        org("wo_run_b", { tags: TAG }),
        org("default", { harnessManaged: true }),
        org("site_admin"),
        org("sales_demo"),
        org("untagged_but_claimed"),
      ],
    ]);
    const owners = ownerMaps({
      harness: { wo_run_a: owner("r1"), untagged_but_claimed: owner("r2") },
    });
    const a = await audit(owners);
    const by = Object.fromEntries(a.resources.map((x) => [x.id, x.classification]));
    assert.deepEqual(by, {
      wo_run_a: "tracked",
      untagged_but_claimed: "tracked",
      wo_run_b: "untracked",
      default: "infra",
      site_admin: "infra",
      sales_demo: "unmanaged",
    });
    assert.deepEqual(a.resources.find((x) => x.id === "wo_run_a")!.owner, owner("r1"));
    assert.equal(a.resources.find((x) => x.id === "wo_run_b")!.owner, null);
    assert.deepEqual(a.counts, { total: 6, untracked: 1, infra: 2, tracked: 2, unmanaged: 1 });
  });

  test("a claim wins over being infrastructure", async () => {
    configure();
    process.env.HARNESS_INFRA_ORGS = "shared";
    serve([[org("shared"), org("default", { harnessManaged: true })]]);
    const a = await audit(ownerMaps({ harness: { shared: owner("r1"), default: owner("r2") } }));
    assert.deepEqual(a.resources.map((x) => x.classification), ["tracked", "tracked"]);
  });

  test("a tag with a different value is not ours", async () => {
    configure();
    serve([[org("x", { tags: { managed_by: "terraform" } }), org("y", { tags: null })]]);
    const a = await audit();
    assert.deepEqual(a.resources.map((x) => x.classification), ["unmanaged", "unmanaged"]);
  });

  test("entries without an identifier are skipped", async () => {
    configure();
    serve([[{}, { organization: {} }, org("real")]]);
    const a = await audit();
    assert.deepEqual(a.resources.map((x) => x.id), ["real"]);
  });
});

describe("missing", () => {
  test("claimed orgs the account no longer has, excluding infrastructure", async () => {
    configure();
    process.env.HARNESS_INFRA_ORGS = "site_admin";
    serve([[org("still_here", { tags: TAG })]]);
    const a = await audit(
      ownerMaps({
        harness: { still_here: owner("r1"), gone: owner("r2"), site_admin: owner("r3") },
      }),
    );
    assert.deepEqual(a.missing, [{ id: "gone", ...owner("r2") }]);
  });
});

describe("paging", () => {
  test("follows totalPages", async () => {
    configure();
    serve([[org("a")], [org("b")], [org("c")]]);
    const a = await audit();
    assert.deepEqual(a.resources.map((x) => x.id), ["a", "b", "c"]);
    const pages = fake.calls
      .filter((c) => c.url.includes("/ng/api/organizations"))
      .map((c) => new URL(c.url).searchParams.get("pageIndex"));
    assert.deepEqual(pages, ["0", "1", "2"]);
  });

  test("stops at an empty page even if totalPages says there are more", async () => {
    configure();
    fake.route = (url) => {
      if (url.pathname === "/ng/api/organizations") {
        const page = Number(url.searchParams.get("pageIndex"));
        return json({ data: { content: page === 0 ? [org("a")] : [], totalPages: 99 } });
      }
      if (url.pathname.startsWith("/ng/api/accounts/")) return json({ data: { name: "W" } });
      return undefined;
    };
    const a = await audit();
    assert.deepEqual(a.resources.map((x) => x.id), ["a"]);
    assert.equal(fake.calls.filter((c) => c.url.includes("/organizations")).length, 2);
  });

  test("a response without totalPages is one page", async () => {
    configure();
    fake.route = (url) => {
      if (url.pathname === "/ng/api/organizations") return json({ data: { content: [org("a")] } });
      if (url.pathname.startsWith("/ng/api/accounts/")) return json({ data: { name: "W" } });
      return undefined;
    };
    await audit();
    assert.equal(fake.calls.filter((c) => c.url.includes("/organizations")).length, 1);
  });
});

describe("presentation", () => {
  test("links each org and the account, trimming a trailing slash from the base URL", async () => {
    configure();
    serve([[org("wo run/1", { name: "Summit" })]]);
    const a = await audit();
    assert.equal(
      a.resources[0]!.url,
      `${BASE}/ng/account/acct123/settings/organizations/wo%20run%2F1/details`,
    );
    assert.equal(a.resources[0]!.name, "Summit");
    assert.deepEqual(a.scope, {
      label: "Harness account",
      value: "acct123",
      name: "Workshops",
      url: `${BASE}/ng/account/acct123/settings/organizations`,
    });
  });

  test("the state column is the creation date, or nothing when Harness did not say", async () => {
    configure();
    serve([[org("a", { createdAt: Date.UTC(2026, 8, 27, 23, 59) }), org("b"), org("c", { createdAt: Number.NaN })]]);
    const a = await audit();
    const state = Object.fromEntries(a.resources.map((x) => [x.id, x.state]));
    assert.deepEqual(state, { a: { label: "2026-09-27", ok: true }, b: null, c: null });
  });

  test("an unreadable account name is null, not a failed audit", async () => {
    configure();
    serve([[org("a")]], null);
    const a = await audit();
    assert.equal(a.scope.name, null);
  });
});

describe("failures", () => {
  for (const [status, expected] of [
    [401, "permission_denied"],
    [403, "permission_denied"],
    [404, "unavailable"],
    [500, "unavailable"],
  ] as const) {
    test(`HTTP ${status} listing orgs is ${expected}`, async () => {
      configure();
      fake.route = () => json({ message: "nope" }, status);
      assert.deepEqual(await auditHarness(ownerMaps()), { ok: false, error: expected });
    });
  }

  test("a non-JSON error page is still classified", async () => {
    configure();
    fake.route = () => new Response("<html>Bad gateway</html>", { status: 502 });
    assert.deepEqual(await auditHarness(ownerMaps()), { ok: false, error: "unavailable" });
  });

  test("a network failure is unavailable", async () => {
    configure();
    fake.route = () => {
      throw new TypeError("fetch failed");
    };
    assert.deepEqual(await auditHarness(ownerMaps()), { ok: false, error: "unavailable" });
  });
});
