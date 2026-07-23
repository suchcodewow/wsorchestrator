import fs from "node:fs";
import path from "node:path";
import { cfg } from "./config.js";

/**
 * Write the per-run terraform.tfvars.json into a workshop root dir.
 * Each job execution owns its container, so mutating the dir in place is safe.
 */
export function writeTfvars(workDir: string, projectId: string, runId: string) {
  const vars = {
    project_id: projectId,
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
  fs.writeFileSync(
    path.join(workDir, "terraform.tfvars.json"),
    JSON.stringify(vars, null, 2),
  );
}
