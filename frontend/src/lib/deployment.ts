/**
 * Which deployment this is, and which runs it may act on.
 *
 * QA can import a backup of production's database (`lib/production-import.ts`).
 * The import stamps every row it brings over `environment = 'production'`, and
 * QA's app shows those runs but will not change, start, retry or delete them.
 * Each of those would hand a production workshop to QA's runner or reaper, and
 * QA shares production's Workspace, Harness and cloud accounts. Rows that
 * predate the column are null and belong to the database they are in.
 *
 * The runner reads the same variable the same way (`runner/src/environment.ts`).
 */

import { eq, isNull, or } from "drizzle-orm";
import { workshopRuns } from "@/db/schema";

export function deploymentEnvironment(): string {
  return process.env.DEPLOYMENT_ENVIRONMENT?.trim() || "production";
}

export function isProduction(): boolean {
  return deploymentEnvironment() === "production";
}

/** The runs this deployment created, as a `where` clause. */
export const localRun = () =>
  or(
    isNull(workshopRuns.environment),
    eq(workshopRuns.environment, deploymentEnvironment()),
  );

/** Whether a run belongs to another deployment and is only a copy here. */
export function isImportedRun(run: { environment: string | null }): boolean {
  return run.environment !== null && run.environment !== deploymentEnvironment();
}
