import fs from "node:fs";
import path from "node:path";
import { gcpCfg } from "./config.js";

/** Settings every root config takes, regardless of event mode. */
function commonVars(runId: string) {
  const cfg = gcpCfg();
  return {
    folder_id: cfg.folderId,
    billing_account: cfg.billingAccount,
    region: cfg.region,
    admin_project_id: cfg.adminProjectId,
    run_id: runId,
    labels: {
      managed_by: "workshop-orchestrator",
      run_id: runId.replace(/-/g, "").slice(0, 12),
    },
  };
}

function write(workDir: string, vars: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(workDir, "terraform.tfvars.json"),
    JSON.stringify(vars, null, 2),
  );
}

/**
 * Write the per-run terraform.tfvars.json into a workshop root dir.
 * Each job execution owns its container, so mutating the dir in place is safe.
 *
 * `attendeeEmails` are the accounts the runner created in Workspace just
 * beforehand; Terraform grants each of them editor on the single shared
 * project. Passing the full list (not just newly added ones) keeps the apply
 * convergent when a workshop grows.
 */
export function writeTfvars(
  workDir: string,
  projectId: string,
  runId: string,
  attendeeEmails: string[] = [],
) {
  write(workDir, {
    ...commonVars(runId),
    project_id: projectId,
    attendee_emails: attendeeEmails,
  });
}

/**
 * Write terraform.tfvars.json for a challenge, whose root config creates one
 * project per competitor instead of one for the whole event.
 *
 * `attendeeProjects` maps each address to the project id it owns. As with a
 * workshop, the whole roster is passed every time so that growing a challenge
 * converges — the entries already in state are unchanged and only the new
 * competitor's project is added.
 */
export function writeChallengeTfvars(
  workDir: string,
  runId: string,
  attendeeProjects: Record<string, string>,
) {
  write(workDir, {
    ...commonVars(runId),
    attendee_projects: attendeeProjects,
  });
}
