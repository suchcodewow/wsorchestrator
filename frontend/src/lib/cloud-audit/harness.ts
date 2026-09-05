import "server-only";

import { harnessBaseUrl } from "@/lib/harness-platform";
import { missingFromCloud, type OwnerMaps } from "./owners";
import {
  summarize,
  type AuditedResource,
  type AuditUnavailable,
  type Classification,
  type CloudAuditResult,
} from "./types";

/**
 * The Harness half of the Cloud Status page.
 *
 * The scope is the Harness account and the boundary is the organization: every
 * run gets exactly one, named after the event, holding a project per attendee
 * (see `provisionHarness` in `runner/src/run.ts`). A sandbox run gets one too —
 * Harness is the whole of what a sandbox run builds.
 *
 * Nothing here costs money, which makes this the one target on the page that
 * isn't about spend. It is about the other thing a torn-down event can leave
 * behind: teardown deletes the org last, after its projects, connectors, secrets
 * and delegates, and Harness refuses to delete an org that still has anything in
 * it. So a teardown that gave up part-way leaves an organization sitting in the
 * account with a workshop's name on it, and nothing else in this app would ever
 * mention it again.
 *
 * The account is shared with the people who build the workshops, so — exactly as
 * on Azure — only an org this orchestrator stamped (`managed_by`, set by
 * `createOrg`) can be `untracked`; the team's own orgs are reported as
 * `unmanaged`. An org created by hand for an event, without that tag, is
 * therefore counted as somebody's rather than as an orphan, which is the honest
 * answer: this page can only speak for what the runner made.
 *
 * Read-only: the only call is listing organizations.
 */

/** The tag value `createOrg` stamps on every organization it creates. */
const MANAGED_BY = "workshop-orchestrator";

/** One page of organizations. Harness caps this at 100. */
const PAGE_SIZE = 100;

/** Long enough for a slow cluster, short enough that the page isn't left hanging. */
const TIMEOUT_MS = 12_000;

type HarnessConfig = { accountId: string; apiKey: string; baseUrl: string };

/**
 * The same account and key the runner provisions with, read from the same env
 * vars (see `infra/admin/app.tf`). Either one missing means Harness isn't
 * configured for this deployment, and the page says so rather than erroring.
 */
function config(): HarnessConfig | null {
  const accountId = process.env.HARNESS_ACCOUNT_ID;
  const apiKey = process.env.HARNESS_API_KEY;
  if (!accountId || !apiKey) return null;
  return { accountId, apiKey, baseUrl: harnessBaseUrl() };
}

/**
 * Organizations that are permanent fixtures rather than events — a shared org
 * the team keeps its own work in, say, that was created through this
 * orchestrator and so carries its tag. Comma-separated identifiers.
 */
function infraOrgs(): Set<string> {
  return new Set(
    (process.env.HARNESS_INFRA_ORGS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

class HarnessError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Organization = {
  identifier?: string;
  name?: string;
  tags?: Record<string, string> | null;
};

type OrganizationEntry = {
  organization?: Organization;
  createdAt?: number;
  /** Harness's own built-in org (`default`) rather than one anybody created. */
  harnessManaged?: boolean;
};

type OrganizationPage = {
  data?: { content?: OrganizationEntry[]; totalPages?: number };
  message?: string;
};

/** Every organization in the account, page by page. */
async function listOrgs(cfg: HarnessConfig): Promise<OrganizationEntry[]> {
  const orgs: OrganizationEntry[] = [];
  for (let pageIndex = 0; ; pageIndex++) {
    const params = new URLSearchParams({
      accountIdentifier: cfg.accountId,
      pageIndex: String(pageIndex),
      pageSize: String(PAGE_SIZE),
    });
    const res = await fetch(`${cfg.baseUrl}/ng/api/organizations?${params}`, {
      headers: { "x-api-key": cfg.apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    const text = await res.text();
    let body: OrganizationPage | null = null;
    try {
      body = JSON.parse(text) as OrganizationPage;
    } catch {
      // Harness answers JSON here; anything else is a gateway talking, and the
      // body is the most useful thing to report.
    }
    if (!res.ok) {
      throw new HarnessError(res.status, body?.message ?? text.slice(0, 200));
    }

    const content = body?.data?.content ?? [];
    orgs.push(...content);
    const totalPages = body?.data?.totalPages ?? 1;
    if (content.length === 0 || pageIndex + 1 >= totalPages) break;
  }
  return orgs;
}

/** What Harness calls the account, so the header reads as more than an id. */
async function accountName(cfg: HarnessConfig): Promise<string | null> {
  try {
    const res = await fetch(`${cfg.baseUrl}/ng/api/accounts/${cfg.accountId}`, {
      headers: { "x-api-key": cfg.apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { name?: string } };
    return body.data?.name ?? null;
  } catch {
    // Optional enrichment — a key that can list organizations cannot always read
    // the account itself.
    return null;
  }
}

/** The same links `runner/src/harness.ts` records on a run. */
const orgUrl = (cfg: HarnessConfig, identifier: string) =>
  `${cfg.baseUrl}/ng/account/${cfg.accountId}/settings/organizations/${encodeURIComponent(identifier)}/details`;

const orgsUrl = (cfg: HarnessConfig) =>
  `${cfg.baseUrl}/ng/account/${cfg.accountId}/settings/organizations`;

/**
 * The day an org was created, as an unambiguous UTC date.
 *
 * Rendered on the server and shipped as a string, deliberately: this page is
 * `force-dynamic` and refreshes through the same server code, so a locale-free
 * date can't disagree with itself between the two.
 */
function createdOn(entry: OrganizationEntry): { label: string; ok: boolean } | null {
  const ms = entry.createdAt;
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return { label: new Date(ms).toISOString().slice(0, 10), ok: true };
}

function classifyError(err: unknown): AuditUnavailable {
  if (!(err instanceof HarnessError)) return "unavailable";
  // A revoked, expired or wrong key is a 401 from Harness; a real key without
  // organization-view rights is a 403. Both are the same problem from here.
  return err.status === 401 || err.status === 403
    ? "permission_denied"
    : "unavailable";
}

export async function auditHarness(owners: OwnerMaps): Promise<CloudAuditResult> {
  const cfg = config();
  if (!cfg) return { ok: false, error: "not_configured" };

  let entries: OrganizationEntry[];
  try {
    entries = await listOrgs(cfg);
  } catch (err) {
    return { ok: false, error: classifyError(err) };
  }

  // Only after the list succeeds — a failed audit shouldn't pay for a name.
  const name = await accountName(cfg);

  const known = owners.byResource.harness;
  const infra = infraOrgs();

  const resources: AuditedResource[] = entries.flatMap((entry) => {
    const identifier = entry.organization?.identifier;
    if (!identifier) return [];

    const ours = entry.organization?.tags?.managed_by === MANAGED_BY;
    const owner = known.get(identifier) ?? null;

    const classification: Classification = owner
      ? "tracked"
      : infra.has(identifier) || entry.harnessManaged
        ? "infra"
        : ours
          ? // Stamped by this orchestrator but claimed by no run: an org whose
            // event is gone, or one a teardown couldn't finish deleting.
            "untracked"
          : "unmanaged";

    return [
      {
        id: identifier,
        // The org's display name is the event's name — the same string the run
        // is called in the events list.
        name: entry.organization?.name ?? null,
        url: orgUrl(cfg, identifier),
        state: createdOn(entry),
        classification,
        owner,
      } satisfies AuditedResource,
    ];
  });

  return {
    ok: true,
    audit: {
      target: "harness",
      scope: {
        label: "Harness account",
        value: cfg.accountId,
        name,
        url: orgsUrl(cfg),
      },
      columns: { id: "Organization", name: "Event name", state: "Created" },
      missing: missingFromCloud(
        known,
        entries.flatMap((e) =>
          e.organization?.identifier ? [e.organization.identifier] : [],
        ),
        infra,
      ),
      ...summarize(resources),
    },
  };
}
