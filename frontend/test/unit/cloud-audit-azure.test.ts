/**
 * The Azure audit: which resource groups in the subscription belong to a run.
 *
 * Azure is the cloud where a group can be claimed two ways. A run's outputs
 * name its groups, but a group whose apply died before outputs were written is
 * only findable by its tags: `managed_by: workshop-orchestrator` plus a
 * `run_id` tag holding the first 12 hex digits of the run id
 * (`runner/src/workspace.ts`). Missing that second path would report every
 * half-built group as untracked and invite someone to delete a run's
 * resources out from under it.
 *
 * Names are compared case-insensitively — ARM returns them in whatever case
 * they were created with — but shown as Azure has them. Subscriptions always
 * hold groups Azure creates itself (`NetworkWatcherRG`), which are
 * `unmanaged`, never `untracked`.
 *
 * `fetch` is replaced with canned token and ARM responses; nothing leaves the
 * process.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { auditAzure } from "@/lib/cloud-audit/azure";
import { json, owner, ownerMaps, withCleanEnv, installFakeFetch } from "../support/cloud-audit";

withCleanEnv([
  "AZURE_SUBSCRIPTION_ID",
  "ARM_SUBSCRIPTION_ID",
  "AZURE_TENANT_ID",
  "ARM_TENANT_ID",
  "ARM_CLIENT_ID",
  "ARM_CLIENT_SECRET",
  "AZURE_INFRA_RESOURCE_GROUPS",
]);
const fake = installFakeFetch();

const SUB = "00000000-1111-2222-3333-444444444444";
const TENANT = "tenant-guid";
const TAG = "workshop-orchestrator";

function configure() {
  process.env.AZURE_SUBSCRIPTION_ID = SUB;
  process.env.AZURE_TENANT_ID = TENANT;
  process.env.ARM_CLIENT_ID = "client";
  process.env.ARM_CLIENT_SECRET = "secret";
}

type Group = {
  id?: string;
  name?: string;
  location?: string;
  tags?: Record<string, string> | null;
  properties?: { provisioningState?: string };
};

const group = (name: string, extra: Partial<Group> = {}): Group => ({
  id: `/subscriptions/${SUB}/resourceGroups/${name}`,
  name,
  location: "eastus",
  tags: {},
  properties: { provisioningState: "Succeeded" },
  ...extra,
});

/**
 * Token endpoint plus paged resource-group listing. `expires_in: 60` makes
 * the module's token cache expire immediately (it subtracts a minute), so no
 * test depends on a token another test fetched.
 */
function serve(pages: Group[][], opts: { token?: Response; subscription?: Response } = {}) {
  fake.route = (url) => {
    if (url.origin === "https://login.microsoftonline.com") {
      return opts.token ?? json({ access_token: "tok", expires_in: 60 });
    }
    if (url.origin !== "https://management.azure.com") return undefined;
    if (url.pathname === `/subscriptions/${SUB}/resourcegroups`) {
      const page = Number(url.searchParams.get("page") ?? "0");
      const next = page + 1 < pages.length ? `https://management.azure.com/subscriptions/${SUB}/resourcegroups?api-version=2021-04-01&page=${page + 1}` : undefined;
      return json({ value: pages[page] ?? [], ...(next ? { nextLink: next } : {}) });
    }
    if (url.pathname === `/subscriptions/${SUB}`) {
      return opts.subscription ?? json({ displayName: "Workshops" });
    }
    return undefined;
  };
}

async function audit(owners = ownerMaps()) {
  const result = await auditAzure(owners);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result.audit;
}

describe("configuration", () => {
  test("needs a subscription, tenant, client id and secret", async () => {
    const full = {
      AZURE_SUBSCRIPTION_ID: SUB,
      AZURE_TENANT_ID: TENANT,
      ARM_CLIENT_ID: "client",
      ARM_CLIENT_SECRET: "secret",
    };
    for (const missing of Object.keys(full)) {
      for (const [k, v] of Object.entries(full)) {
        if (k === missing) delete process.env[k];
        else process.env[k] = v;
      }
      assert.deepEqual(await auditAzure(ownerMaps()), { ok: false, error: "not_configured" }, missing);
    }
    assert.equal(fake.calls.length, 0);
  });

  test("the subscription and tenant may come from the ARM_ variables Terraform uses", async () => {
    process.env.ARM_SUBSCRIPTION_ID = SUB;
    process.env.ARM_TENANT_ID = TENANT;
    process.env.ARM_CLIENT_ID = "client";
    process.env.ARM_CLIENT_SECRET = "secret";
    serve([[]]);
    const a = await audit();
    assert.equal(a.scope.value, SUB);
    assert.ok(fake.calls.some((c) => c.url === `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`));
  });

  test("sends the bearer token it was issued", async () => {
    configure();
    serve([[]]);
    await audit();
    const arm = fake.calls.find((c) => c.url.startsWith("https://management.azure.com"))!;
    assert.equal((arm.init?.headers as Record<string, string>).authorization, "Bearer tok");
  });
});

describe("classification", () => {
  const RUN_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  const RUN_TAG = "3f2504e04f89";

  test("by outputs, by tag, as infrastructure, as ours-but-unclaimed, and as Azure's own", async () => {
    configure();
    process.env.AZURE_INFRA_RESOURCE_GROUPS = "Site-Infra, other";
    serve([
      [
        group("WO-Run-A", { tags: { managed_by: TAG } }),
        group("wo-halfbuilt", { tags: { managed_by: TAG, run_id: RUN_TAG } }),
        group("wo-orphan", { tags: { managed_by: TAG, run_id: "ffffffffffff" } }),
        group("site-infra"),
        group("NetworkWatcherRG", { tags: null }),
      ],
    ]);
    const owners = ownerMaps(
      { azure: { "wo-run-a": owner("r1") } },
      { [RUN_TAG]: owner(RUN_ID) },
    );
    const a = await audit(owners);
    const by = Object.fromEntries(a.resources.map((x) => [x.id, [x.classification, x.owner?.runId ?? null]]));
    assert.deepEqual(by, {
      "WO-Run-A": ["tracked", "r1"],
      "wo-halfbuilt": ["tracked", RUN_ID],
      "wo-orphan": ["untracked", null],
      "site-infra": ["infra", null],
      NetworkWatcherRG: ["unmanaged", null],
    });
  });

  test("a run_id tag without managed_by is not a claim", async () => {
    configure();
    serve([[group("someone-else", { tags: { run_id: RUN_TAG } })]]);
    const a = await audit(ownerMaps({}, { [RUN_TAG]: owner(RUN_ID) }));
    assert.equal(a.resources[0]!.classification, "unmanaged");
    assert.equal(a.resources[0]!.owner, null);
  });

  test("groups without a name are skipped", async () => {
    configure();
    serve([[{ id: "/x" }, group("real")]]);
    const a = await audit();
    assert.deepEqual(a.resources.map((x) => x.id), ["real"]);
  });

  test("state is the provisioning state, ok only when Succeeded", async () => {
    configure();
    serve([
      [
        group("a"),
        group("b", { properties: { provisioningState: "Deleting" } }),
        group("c", { properties: {} }),
      ],
    ]);
    const a = await audit();
    const state = Object.fromEntries(a.resources.map((x) => [x.id, x.state]));
    assert.deepEqual(state, {
      a: { label: "succeeded", ok: true },
      b: { label: "deleting", ok: false },
      c: { label: "unknown", ok: false },
    });
  });

  test("links into the portal under the tenant, and shows the location as the name", async () => {
    configure();
    serve([[group("a", { location: "westeurope" }), group("b", { id: undefined })]]);
    const a = await audit();
    const [ra, rb] = a.resources;
    assert.equal(ra!.url, `https://portal.azure.com/#@${TENANT}/resource/subscriptions/${SUB}/resourceGroups/a`);
    assert.equal(ra!.name, "westeurope");
    assert.equal(rb!.url, null);
  });
});

describe("missing", () => {
  test("compares case-insensitively and excludes infrastructure", async () => {
    configure();
    process.env.AZURE_INFRA_RESOURCE_GROUPS = "site-infra";
    serve([[group("WO-RUN-A")]]);
    const a = await audit(
      ownerMaps({
        azure: { "wo-run-a": owner("r1"), "wo-gone": owner("r2"), "site-infra": owner("r3") },
      }),
    );
    assert.deepEqual(a.missing, [{ id: "wo-gone", ...owner("r2") }]);
  });
});

describe("paging and scope", () => {
  test("follows nextLink until there is none", async () => {
    configure();
    serve([[group("a")], [group("b")], [group("c")]]);
    const a = await audit();
    assert.deepEqual(a.resources.map((x) => x.id), ["a", "b", "c"]);
  });

  test("names the subscription, or leaves the name out if it cannot be read", async () => {
    configure();
    serve([[]]);
    assert.equal((await audit()).scope.name, "Workshops");
    serve([[]], { subscription: json({}, 403) });
    assert.equal((await audit()).scope.name, null);
  });
});

describe("failures", () => {
  test("a rejected client secret (400 from the token endpoint) is permission_denied", async () => {
    configure();
    serve([[]], { token: json({ error_description: "AADSTS7000215: Invalid client secret provided." }, 400) });
    assert.deepEqual(await auditAzure(ownerMaps()), { ok: false, error: "permission_denied" });
  });

  test("a token response without a token is treated as a failure", async () => {
    configure();
    serve([[]], { token: json({}) });
    assert.deepEqual(await auditAzure(ownerMaps()), { ok: false, error: "unavailable" });
  });

  for (const [status, expected] of [
    [401, "permission_denied"],
    [403, "permission_denied"],
    [429, "unavailable"],
    [500, "unavailable"],
  ] as const) {
    test(`HTTP ${status} listing groups is ${expected}`, async () => {
      configure();
      fake.route = (url) =>
        url.origin === "https://login.microsoftonline.com"
          ? json({ access_token: "tok", expires_in: 60 })
          : new Response("denied", { status });
      assert.deepEqual(await auditAzure(ownerMaps()), { ok: false, error: expected });
    });
  }

  test("a network failure is unavailable", async () => {
    configure();
    fake.route = () => {
      throw new TypeError("fetch failed");
    };
    assert.deepEqual(await auditAzure(ownerMaps()), { ok: false, error: "unavailable" });
  });
});
