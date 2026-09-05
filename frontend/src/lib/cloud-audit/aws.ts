import "server-only";

import { createHash, createHmac } from "node:crypto";
import { missingFromCloud, type OwnerMaps } from "./owners";
import {
  summarize,
  type AuditedResource,
  type AuditUnavailable,
  type CloudAuditResult,
} from "./types";

/**
 * The AWS half of the Cloud Status page.
 *
 * The scope is the organization: every workshop run creates a member account
 * (`aws_organizations_account`, see `runner/terraform/workshops/aws-base`), so
 * "every account in the org" is the AWS analog of "every project on the billing
 * account" — the org is also the billing boundary, since a member account's
 * charges roll up to the management account's bill.
 *
 * Signed by hand rather than with `@aws-sdk/client-organizations`: two read-only
 * calls do not justify pulling the AWS SDK into the web app's bundle, and SigV4
 * over `node:crypto` is a page of code. The requests are `ListAccounts` and
 * `DescribeOrganization`, both read-only — the credentials are the management
 * account's, so nothing here is allowed to be more than that.
 */

/**
 * Organizations is a global service reached through one regional endpoint, and
 * it is signed for that region no matter what `AWS_REGION` says — signing for
 * (say) eu-west-1 is refused with a credential-scope error.
 */
const HOST = "organizations.us-east-1.amazonaws.com";
const SIGNING_REGION = "us-east-1";
const SERVICE = "organizations";
const TARGET_PREFIX = "AWSOrganizationsV20161128";

type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

/**
 * The management-account credentials, the same pair the runner provisions with
 * (see `infra/admin/app.tf`). Absent — an AWS-less deployment — the audit
 * reports itself unconfigured rather than failing.
 */
function credentials(): AwsCredentials | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
  };
}

/** Extra accounts that are permanent fixtures rather than runs. Comma-separated. */
function infraAccountIds(): Set<string> {
  return new Set(
    (process.env.AWS_INFRA_ACCOUNT_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

const sha256 = (data: string) =>
  createHash("sha256").update(data, "utf8").digest("hex");
const hmac = (key: Buffer | string, data: string) =>
  createHmac("sha256", key).update(data, "utf8").digest();

/** `20260905T123456Z` — SigV4 wants basic-format ISO 8601, no separators. */
const amzDate = (now: Date) =>
  now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Anything the API answers that isn't a 2xx, so the caller can classify it. */
class AwsError extends Error {
  constructor(
    readonly status: number,
    /** The `__type` field AWS puts the exception name in, when there is one. */
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * One signed JSON-1.1 call against Organizations.
 *
 * The signature covers the four headers below plus a SHA-256 of the body. `host`
 * has to be among them and has to match what actually goes on the wire, which is
 * why it's set from the same constant the URL is built from.
 */
async function organizations<T>(action: string, body: object): Promise<T> {
  const creds = credentials();
  if (!creds) throw new AwsError(0, "NotConfigured", "No AWS credentials");

  const payload = JSON.stringify(body);
  const date = amzDate(new Date());
  const dateStamp = date.slice(0, 8);

  const headers: Record<string, string> = {
    "content-type": "application/x-amz-json-1.1",
    host: HOST,
    "x-amz-date": date,
    "x-amz-target": `${TARGET_PREFIX}.${action}`,
  };
  if (creds.sessionToken) headers["x-amz-security-token"] = creds.sessionToken;

  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    "POST",
    "/",
    "",
    names.map((h) => `${h}:${headers[h]!.trim()}\n`).join(""),
    signedHeaders,
    sha256(payload),
  ].join("\n");

  const scope = `${dateStamp}/${SIGNING_REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    date,
    scope,
    sha256(canonicalRequest),
  ].join("\n");

  // The signing key is the secret walked through date -> region -> service ->
  // terminator, so a leaked signature is only good for that one combination.
  const kDate = hmac(`AWS4${creds.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, SIGNING_REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning)
    .update(stringToSign, "utf8")
    .digest("hex");

  const res = await fetch(`https://${HOST}/`, {
    method: "POST",
    cache: "no-store",
    body: payload,
    headers: {
      ...headers,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });

  const text = await res.text();
  if (!res.ok) {
    const parsed = (() => {
      try {
        return JSON.parse(text) as { __type?: string; message?: string };
      } catch {
        return {};
      }
    })();
    // `__type` is `com.amazonaws...#AccessDeniedException`; only the tail matters.
    const code = (parsed.__type ?? "").split("#").pop() || `Http${res.status}`;
    throw new AwsError(res.status, code, parsed.message ?? text.slice(0, 200));
  }
  return JSON.parse(text) as T;
}

type Organization = {
  Organization?: { Id?: string; MasterAccountId?: string };
};

type Account = {
  Id?: string;
  Name?: string;
  Email?: string;
  Status?: string;
};

type ListAccounts = { Accounts?: Account[]; NextToken?: string };

/** Every account in the organization, following pagination. */
async function listAccounts(): Promise<Account[]> {
  const accounts: Account[] = [];
  let next: string | undefined;
  do {
    const data = await organizations<ListAccounts>("ListAccounts", {
      MaxResults: 20,
      ...(next ? { NextToken: next } : {}),
    });
    accounts.push(...(data.Accounts ?? []));
    next = data.NextToken || undefined;
  } while (next);
  return accounts;
}

/**
 * An AWS account's console is reached through its sign-in alias, which
 * `ListAccounts` doesn't return — reading it means assuming a role into each
 * account, which is far more than an audit should do. So this links to the
 * account's page in the organization console instead, which is where an admin
 * looking at this table wants to end up anyway.
 */
const orgConsoleUrl = (accountId: string) =>
  `https://${SIGNING_REGION}.console.aws.amazon.com/organizations/v2/home/accounts/${encodeURIComponent(accountId)}`;

/**
 * `SUSPENDED` is a closed account: AWS keeps it listed for 90 days after
 * closure, costing nothing. Shown as not-ok so a closed account that a run still
 * claims is visible, but it is never the reason a row is flagged.
 */
const ACCOUNT_OK = new Set(["ACTIVE"]);

function classify(err: unknown): AuditUnavailable {
  if (!(err instanceof AwsError)) return "unavailable";
  if (err.status === 403 || err.status === 401) return "permission_denied";
  return err.code === "AccessDeniedException" ||
    err.code === "UnrecognizedClientException" ||
    err.code === "InvalidClientTokenId" ||
    err.code === "SignatureDoesNotMatch"
    ? "permission_denied"
    : "unavailable";
}

export async function auditAws(owners: OwnerMaps): Promise<CloudAuditResult> {
  if (!credentials()) return { ok: false, error: "not_configured" };

  let accounts: Account[];
  let org: Organization["Organization"];
  try {
    // The org description names the management account, which is the one account
    // guaranteed not to be a run — so it has to land before anything is
    // classified, not alongside.
    [org, accounts] = await Promise.all([
      organizations<Organization>("DescribeOrganization", {}).then(
        (d) => d.Organization,
      ),
      listAccounts(),
    ]);
  } catch (err) {
    return { ok: false, error: classify(err) };
  }

  const known = owners.byResource.aws;
  const infra = infraAccountIds();
  if (org?.MasterAccountId) infra.add(org.MasterAccountId);

  const resources: AuditedResource[] = accounts.flatMap((a) => {
    if (!a.Id) return [];
    const owner = known.get(a.Id) ?? null;
    const status = a.Status ?? "UNKNOWN";
    return [
      {
        id: a.Id,
        name: a.Name ?? null,
        url: orgConsoleUrl(a.Id),
        state: { label: status.toLowerCase(), ok: ACCOUNT_OK.has(status) },
        // Like GCP, the whole scope is this deployment's: an account in the org
        // bills to our management account whether a run made it or not.
        classification: owner ? "tracked" : infra.has(a.Id) ? "infra" : "untracked",
        owner,
      } satisfies AuditedResource,
    ];
  });

  return {
    ok: true,
    audit: {
      cloud: "aws",
      scope: {
        label: "Organization",
        value: org?.Id ?? "unknown",
        name: null,
        url: `https://${SIGNING_REGION}.console.aws.amazon.com/organizations/v2/home/accounts`,
      },
      columns: { id: "Account", name: "Account name", state: "Status" },
      missing: missingFromCloud(
        known,
        accounts.flatMap((a) => (a.Id ? [a.Id] : [])),
        infra,
      ),
      ...summarize(resources),
    },
  };
}
