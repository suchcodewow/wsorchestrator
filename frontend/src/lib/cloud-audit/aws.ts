/** The AWS half of the Cloud Status page. */

import "server-only";

import { createHash, createHmac } from "node:crypto";
import { missingFromCloud, type OwnerMaps } from "./owners";
import {
  summarize,
  type AuditedResource,
  type AuditUnavailable,
  type CloudAuditResult,
} from "./types";

const HOST = "organizations.us-east-1.amazonaws.com";
const SIGNING_REGION = "us-east-1";
const SERVICE = "organizations";
const TARGET_PREFIX = "AWSOrganizationsV20161128";

type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

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

const amzDate = (now: Date) =>
  now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

class AwsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

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

const orgConsoleUrl = (accountId: string) =>
  `https://${SIGNING_REGION}.console.aws.amazon.com/organizations/v2/home/accounts/${encodeURIComponent(accountId)}`;

const CLOSED = "SUSPENDED";

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
    if (a.Status === CLOSED) return [];
    const owner = known.get(a.Id) ?? null;
    const status = a.Status ?? "UNKNOWN";
    return [
      {
        id: a.Id,
        name: a.Name ?? null,
        url: orgConsoleUrl(a.Id),
        state: { label: status.toLowerCase(), ok: ACCOUNT_OK.has(status) },
        classification: owner ? "tracked" : infra.has(a.Id) ? "infra" : "untracked",
        owner,
      } satisfies AuditedResource,
    ];
  });

  return {
    ok: true,
    audit: {
      target: "aws",
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
