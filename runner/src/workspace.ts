import fs from "node:fs";
import path from "node:path";
import { gcpCfg } from "./config.js";

/**
 * Write the per-run terraform.tfvars.json into a workshop root dir.
 * Each job execution owns its container, so mutating the dir in place is safe.
 *
 * `attendeeEmails` are the accounts the runner created in Workspace just
 * beforehand; Terraform grants each of them editor on the project. Passing the
 * full list (not just newly added ones) keeps the apply convergent when a
 * workshop grows.
 */
export function writeTfvars(
  workDir: string,
  projectId: string,
  runId: string,
  attendeeEmails: string[] = [],
) {
  const cfg = gcpCfg();
  const vars = {
    project_id: projectId,
    folder_id: cfg.folderId,
    billing_account: cfg.billingAccount,
    region: cfg.region,
    admin_project_id: cfg.adminProjectId,
    run_id: runId,
    attendee_emails: attendeeEmails,
    labels: {
      managed_by: "workshop-orchestrator",
      run_id: runId.replace(/-/g, "").slice(0, 12),
    },
  };
  fs.writeFileSync(
    path.join(workDir, "terraform.tfvars.json"),
    JSON.stringify(vars, null, 2),
  );
}
