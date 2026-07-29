import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Root of the bundled Terraform tree (runner/terraform). */
export const TF_ROOT = process.env.TF_ROOT ?? path.resolve(here, "../terraform");

/**
 * Terraform binary. Kept configurable because some machines have OpenTofu
 * (`tofu`) rather than `terraform`.
 */
export const TF_BIN = process.env.TF_BIN ?? "terraform";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

export const region = process.env.GCP_REGION ?? "us-central1";

/**
 * GCP config, read lazily — a workshop that asks for no GCP environment must
 * still be able to provision its Workspace accounts without these set.
 */
export function gcpCfg() {
  return {
    stateBucket: required("GCP_TFSTATE_BUCKET"),
    folderId: required("GCP_WORKSHOPS_FOLDER_ID"),
    billingAccount: required("GCP_BILLING_ACCOUNT_ID"),
    adminProjectId: required("GCP_ADMIN_PROJECT_ID"),
    region,
  };
}

/**
 * Google Workspace config for attendee account creation. `adminEmail` is the
 * super-admin the runner's service account impersonates via domain-wide
 * delegation; `customerId` defaults to the impersonated account's own customer.
 */
export function workspaceCfg() {
  return {
    domain: required("GOOGLE_WORKSPACE_DOMAIN"),
    adminEmail: required("GOOGLE_WORKSPACE_ADMIN_EMAIL"),
    customerId: process.env.GOOGLE_WORKSPACE_CUSTOMER_ID ?? "my_customer",
    /** OU the per-workshop org units are created under. */
    parentOrgUnitPath: process.env.GOOGLE_WORKSPACE_PARENT_OU ?? "/",
  };
}

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
