/**
 * Which deployment this runner belongs to, and which runs it may act on.
 *
 * QA can import a backup of production's database (see `import-production.ts`).
 * Production's rows name production's live Workspace users, Harness orgs and
 * cloud accounts. QA shares those accounts with production, so nothing outside
 * this check would stop QA's reaper from tearing them down. Every imported row is
 * stamped `production`. A runner acts only on rows stamped with its own
 * environment, or on rows that predate the column (null), which belong to the
 * database they are in.
 *
 * Unset means production, which is what the column's null means too. The
 * frontend reads the same variable the same way (`lib/deployment.ts`).
 */
export function deploymentEnvironment(): string {
  return process.env.DEPLOYMENT_ENVIRONMENT?.trim() || "production";
}

/** The SQL guard for `workshop_runs`, with the environment as parameter `$n`. */
export function localRunClause(param: number): string {
  return `(environment is null or environment = $${param})`;
}
