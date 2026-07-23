import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Root of the bundled Terraform tree (runner/terraform). */
export const TF_ROOT = process.env.TF_ROOT ?? path.resolve(here, "../terraform");

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

export const cfg = {
  stateBucket: required("GCP_TFSTATE_BUCKET"),
  folderId: required("GCP_WORKSHOPS_FOLDER_ID"),
  billingAccount: required("GCP_BILLING_ACCOUNT_ID"),
  adminProjectId: required("GCP_ADMIN_PROJECT_ID"),
  region: process.env.GCP_REGION ?? "us-central1",
};

/** Derive a valid, globally-unique GCP project id from a run. */
export function makeProjectId(slug: string, runId: string): string {
  const short = runId.replace(/-/g, "").slice(0, 6);
  const id = `ws-${slug}-${short}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 30)
    .replace(/-+$/, "");
  return id;
}
