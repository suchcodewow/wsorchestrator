/**
 * Works out what a guide's `{{variables}}` should say for the person reading it:
 * the run and account their cookie points at, with anything they typed by hand
 * winning over what the run provisioned.
 */

import "server-only";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { workshopAccounts, workshopRuns } from "@/db/schema";
import {
  EMPTY_GUIDE_CONTEXT,
  GUIDE_CONTEXT_COOKIE,
  parseGuideContext,
  type GuideContext,
  type GuideValues,
} from "@/lib/guide-variables";

/** Where a reader's values came from, so the page can say so and offer to change it. */
export type GuideReader = {
  context: GuideContext;
  /** The run and account the cookie names, if both still exist. */
  event: { name: string; email: string } | null;
  /** What the run provisioned, before anything the reader typed over it. */
  provided: GuideValues;
  values: GuideValues;
};

const NO_READER: GuideReader = {
  context: EMPTY_GUIDE_CONTEXT,
  event: null,
  provided: {},
  values: {},
};

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function map(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Both links are built by the runner (`orgUrl` and `projectUrl` in
// runner/src/harness.ts), which emits the finished URL rather than the pieces so
// the identifier rules live in one place. Reading the pieces back out of the URL
// keeps that true: this is the same one source, read rather than re-derived.
const PROJECT_URL =
  /\/ng\/account\/([^/?#]+)\/home\/orgs\/([^/?#]+)\/projects\/([^/?#]+)/;
const ORG_URL = /\/ng\/account\/([^/?#]+)\/settings\/organizations\/([^/?#]+)/;

const DEFAULT_AWS_REGION = "us-east-1";

type RunRow = {
  name: string;
  gcpProjectId: string | null;
  outputs: unknown;
};

function valuesOf(run: RunRow, email: string): GuideValues {
  const outputs = map(run.outputs);

  const projectUrl = str(map(outputs.harness_project_urls)[email]);
  const orgUrl = str(outputs.harness_org_url);

  const project = projectUrl?.match(PROJECT_URL);
  const org = orgUrl?.match(ORG_URL);

  const values: GuideValues = {
    workshop: run.name,
    email,
    project: project?.[3],
    projectUrl,
    org: str(outputs.harness_org) ?? project?.[2] ?? org?.[2],
    orgUrl,
    account: project?.[1] ?? org?.[1],
    gcpProject:
      str(map(outputs.gcp_projects)[email]) ??
      str(outputs.gcp_project_id) ??
      str(run.gcpProjectId) ??
      str(outputs.sandbox_project_id),
    awsAccount:
      str(map(outputs.aws_accounts)[email]) ?? str(outputs.aws_account_id),
    awsRegion: str(outputs.aws_region) ?? DEFAULT_AWS_REGION,
  };

  // A run that never provisioned a cloud leaves holes rather than empty strings,
  // so a hand-typed value can fill them and `missing` stays accurate.
  for (const name of Object.keys(values) as (keyof GuideValues)[]) {
    if (values[name] === undefined) delete values[name];
  }

  return values;
}

async function eventValues(
  runId: string,
  accountId: number,
): Promise<{ event: { name: string; email: string }; values: GuideValues } | null> {
  const [run, account] = await Promise.all([
    db.query.workshopRuns.findFirst({
      where: eq(workshopRuns.id, runId),
      columns: { name: true, gcpProjectId: true, outputs: true },
    }),
    db.query.workshopAccounts.findFirst({
      where: and(
        eq(workshopAccounts.runId, runId),
        eq(workshopAccounts.id, accountId),
      ),
      columns: { email: true },
    }),
  ]);

  if (!run || !account) return null;

  return {
    event: { name: run.name, email: account.email },
    values: valuesOf(run, account.email),
  };
}

/**
 * Read once per guide render. The account is looked up rather than trusted from
 * the cookie so an ended event — accounts deleted with the run — stops filling
 * guides in with a project that is gone.
 */
export async function readGuideReader(): Promise<GuideReader> {
  const raw = (await cookies()).get(GUIDE_CONTEXT_COOKIE)?.value;
  if (!raw) return NO_READER;

  const context = parseGuideContext(raw);

  const provisioned =
    context.runId !== null && context.accountId !== null
      ? await eventValues(context.runId, context.accountId)
      : null;

  const provided = provisioned?.values ?? {};

  return {
    context,
    event: provisioned?.event ?? null,
    provided,
    values: { ...provided, ...context.typed },
  };
}
