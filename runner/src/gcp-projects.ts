/**
 * Tearing down a run's own GCP projects by deleting them outright.
 *
 * Every GCP resource a workshop or challenge builds lives inside the run's own
 * project — the cluster, its network, the scenario firewalls and DNS zones, the
 * Harness service account and its key. Deleting the project removes all of
 * them, so the reaper deletes the project and then the run's GCP state, instead
 * of having `tofu destroy` take each resource down in dependency order first.
 * That ordering was the fragile part: on 2026-09-15 a challenge's scenario layer
 * would not destroy, its firewalls kept the cluster's network alive, the network
 * delete failed, and the project — the only step that mattered — never ran.
 *
 * Nothing here is used for the shared sandbox project, which outlives every run.
 * A no-cloud run's teardown still goes through `tofu destroy`, which removes
 * only that run's cluster and grants. `projectDeleteRefusal` refuses the
 * sandbox and the admin project by id as well, in case one is ever passed here.
 */

import { GoogleAuth } from "google-auth-library";
import { httpStatusOf, withRetry } from "./retry.js";
import { scenarioById } from "./scenarios.js";

const RESOURCE_MANAGER_API = "https://cloudresourcemanager.googleapis.com/v3";
const STORAGE_API = "https://storage.googleapis.com/storage/v1";

/** The `run_id` label the runner stamps on what it builds (see workspace.ts). */
export function runLabel(runId: string): string {
  return runId.replace(/-/g, "").slice(0, 12);
}

export type GcpProject = {
  projectId: string;
  /** `folders/<id>` or `organizations/<id>`. */
  parent: string;
  state: string;
  labels: Record<string, string>;
};

export type DeleteGuard = {
  runId: string;
  folderId: string;
  adminProjectId: string;
  sandboxProjectId: string;
};

/**
 * Why `project` must not be deleted on this run's behalf, or null if it may.
 *
 * Each condition is one this run's own project always meets, so a refusal
 * means the id is wrong or the project is not what it seems. Teardown then
 * fails and waits for a person rather than guessing. Both sandbox projects sit
 * in the workshops folder labelled `managed_by=workshop-orchestrator`, so the
 * folder and that label are not enough on their own. The `run_id` label is
 * what tells a run's project apart, and the sandbox carries none.
 */
export function projectDeleteRefusal(
  project: GcpProject,
  guard: DeleteGuard,
): string | null {
  const id = project.projectId;
  if (id === guard.adminProjectId) return `${id} is the admin project`;
  if (guard.sandboxProjectId && id === guard.sandboxProjectId) {
    return `${id} is the shared sandbox project`;
  }
  if (project.parent !== `folders/${guard.folderId}`) {
    return `${id} is in ${project.parent || "no parent"}, not the workshops folder folders/${guard.folderId}`;
  }
  if (project.labels.managed_by !== "workshop-orchestrator") {
    return `${id} is not labelled managed_by=workshop-orchestrator`;
  }
  const expected = runLabel(guard.runId);
  if (project.labels.run_id !== expected) {
    return `${id} is labelled run_id=${project.labels.run_id ?? "(none)"}, not this run's ${expected}`;
  }
  return null;
}

/**
 * Which of the objects under a run's state prefix belong to its GCP layers.
 *
 * A run spanning several clouds keeps them all under one prefix (see
 * `cloudStatePrefix`), so this picks out GCP's: the base root's own state
 * (`<base>/default.tfstate`), the challenge cluster layer (`<base>/cluster/`),
 * the GKE delegate (`<base>/delegate/gcp/`) and GCP scenario layers
 * (`<base>/scenarios/gcp-…/`). AWS and Azure live under `<base>/aws/` and
 * `<base>/azure/`, and their scenarios under `<base>/scenarios/` with their own
 * cloud's ids, and none of those is selected.
 */
export function gcpStateObjects(base: string, names: string[]): string[] {
  const root = `${base}/`;
  return names.filter((name) => {
    if (!name.startsWith(root)) return false;
    const rest = name.slice(root.length);
    if (!rest.includes("/")) return /\.(tfstate|tflock)$/.test(rest);
    if (rest.startsWith("cluster/")) return true;
    if (rest.startsWith("delegate/gcp/")) return true;
    if (rest.startsWith("scenarios/")) {
      const id = rest.split("/")[1] ?? "";
      const scenario = scenarioById(id);
      return scenario ? scenario.cloud === "gcp" : id.startsWith("gcp-");
    }
    return false;
  });
}

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

async function call<T>(
  url: string,
  method: "GET" | "DELETE" = "GET",
): Promise<T> {
  const client = await auth.getClient();
  const res = await client.request<T>({ url, method });
  return res.data;
}

type ProjectResource = {
  projectId?: string;
  parent?: string;
  state?: string;
  labels?: Record<string, string>;
};

function toProject(p: ProjectResource): GcpProject {
  return {
    projectId: p.projectId ?? "",
    parent: p.parent ?? "",
    state: p.state ?? "",
    labels: p.labels ?? {},
  };
}

/**
 * The project, or null if it is not there to delete.
 *
 * runner-sa can read every project in the workshops folder, and Resource
 * Manager answers 403 rather than 404 for a project that does not exist, so
 * either status means there is nothing in the folder by that id: never
 * created, or deleted and purged.
 */
export async function getProject(projectId: string): Promise<GcpProject | null> {
  try {
    return toProject(
      await withRetry(
        () =>
          call<ProjectResource>(
            `${RESOURCE_MANAGER_API}/projects/${encodeURIComponent(projectId)}`,
          ),
        { label: `Resource Manager (get project ${projectId})` },
      ),
    );
  } catch (err) {
    const status = httpStatusOf(err);
    if (status === 403 || status === 404) return null;
    throw err;
  }
}

/**
 * ACTIVE projects in the folder carrying this run's `run_id` label. These are
 * found by search, not computed, so a challenge competitor whose roster row was
 * lost is still found. Search is eventually consistent, which is why this is
 * unioned with the ids the run computes and never replaces them.
 */
export async function searchRunProjects(
  runId: string,
  folderId: string,
): Promise<string[]> {
  const query = `parent:folders/${folderId} labels.run_id:${runLabel(runId)} state:ACTIVE`;
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const qs = new URLSearchParams({ query, pageSize: "100" });
    if (pageToken) qs.set("pageToken", pageToken);
    const data = await withRetry(
      () =>
        call<{ projects?: ProjectResource[]; nextPageToken?: string }>(
          `${RESOURCE_MANAGER_API}/projects:search?${qs}`,
        ),
      { label: "Resource Manager (search projects)" },
    );
    for (const p of data.projects ?? []) if (p.projectId) ids.push(p.projectId);
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);
  return ids;
}

type Operation = { name?: string; done?: boolean; error?: { message?: string } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Delete the project and wait for Resource Manager to accept it. The project
 * then sits in DELETE_REQUESTED for 30 days. Its resources stop at once, and
 * they and their billing go with it.
 */
export async function deleteProject(projectId: string): Promise<void> {
  const label = `Resource Manager (delete project ${projectId})`;
  let op = await withRetry(
    () =>
      call<Operation>(
        `${RESOURCE_MANAGER_API}/projects/${encodeURIComponent(projectId)}`,
        "DELETE",
      ),
    { label },
  );
  const started = Date.now();
  while (!op.done && op.name) {
    if (Date.now() - started > 5 * 60_000) {
      throw new Error(`${label}: still running after 5 minutes (${op.name})`);
    }
    await sleep(3_000);
    const name = op.name;
    op = await withRetry(() => call<Operation>(`${RESOURCE_MANAGER_API}/${name}`), {
      label,
    });
  }
  if (op.error) {
    throw new Error(`${label} failed: ${op.error.message ?? JSON.stringify(op.error)}`);
  }
}

/** Every object name under `prefix` in `bucket`. */
export async function listStateObjects(
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const names: string[] = [];
  let pageToken: string | undefined;
  do {
    const qs = new URLSearchParams({ prefix, fields: "items(name),nextPageToken" });
    if (pageToken) qs.set("pageToken", pageToken);
    const data = await withRetry(
      () =>
        call<{ items?: Array<{ name?: string }>; nextPageToken?: string }>(
          `${STORAGE_API}/b/${encodeURIComponent(bucket)}/o?${qs}`,
        ),
      { label: "Cloud Storage (list state)" },
    );
    for (const o of data.items ?? []) if (o.name) names.push(o.name);
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);
  return names;
}

/**
 * Delete one state object. The bucket keeps old versions, so a deleted state
 * file can still be recovered. A 404 means it is already gone.
 */
export async function deleteStateObject(bucket: string, name: string): Promise<void> {
  try {
    await withRetry(
      () =>
        call<unknown>(
          `${STORAGE_API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}`,
          "DELETE",
        ),
      { label: `Cloud Storage (delete ${name})` },
    );
  } catch (err) {
    if (httpStatusOf(err) === 404) return;
    throw err;
  }
}
