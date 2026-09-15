/**
 * The scenarios an organizer can layer onto a challenge.
 *
 * **Mirrors the `scenario.json` manifests under `runner/terraform/scenarios/`,**
 * which are the source of truth. The two cannot be one file: the runner and
 * this app are built from different Docker contexts, so neither can read the
 * other's tree at build time.
 *
 * Deliberately free of imports, so `runner/test/scenario-catalog.test.ts` can
 * load it directly and fail when it drifts from the manifests — the same trick
 * `harness-identifier.ts` uses to let the runner check the two implementations
 * of an identifier against each other. Adding a dependency here (drizzle, a
 * path alias, anything) breaks that test's ability to import it, and the mirror
 * goes unguarded.
 *
 * See `runner/terraform/scenarios/README.md` for how to add one.
 */

/** Mirrors `CLOUDS` in the Drizzle schema; kept local to stay import-free. */
type ScenarioCloud = "aws" | "azure" | "gcp";

// Declared cluster-first per cloud: the picker renders them in this order, and
// the thing everything else depends on should be the thing at the top.
export const SCENARIOS = [
  {
    id: "gcp-cluster",
    label: "Kubernetes cluster",
    cloud: "gcp",
    description:
      "Builds each competitor a GKE cluster in their own project. On its own that is all it does — a working cluster and nothing wrong with it. Every scenario below needs one, and turns it on automatically.",
    providesCluster: true,
  },
  {
    id: "gcp-connectivity-egress",
    label: "Connectivity: Egress",
    cloud: "gcp",
    description:
      "Nothing leaves the VPC. Every image pull fails, the competitor's own included, and pods across the cluster sit in ImagePullBackOff.",
    requiresCluster: true,
  },
  {
    id: "gcp-connectivity-binauthz",
    label: "Connectivity: Binary Auth",
    cloud: "gcp",
    description:
      "Only images from the competitor's own registries are admitted. Anything else is denied at pod admission and never pulled.",
    requiresCluster: true,
  },
  {
    id: "gcp-delegate-blocked-manager",
    label: "Delegate: Blocked Manager",
    cloud: "gcp",
    description:
      "The cluster is healthy and images pull, but nothing reaches the public internet. A Harness delegate installs and starts, then fills its log with connection failures and never registers.",
    requiresCluster: true,
  },
  {
    id: "aws-cluster",
    label: "Kubernetes cluster",
    cloud: "aws",
    description:
      "Builds each competitor an EKS cluster in their own account. On its own that is all it does — a working cluster and nothing wrong with it. Every scenario below needs one, and turns it on automatically.",
    providesCluster: true,
  },
  {
    id: "aws-connectivity-egress",
    label: "Connectivity: Egress",
    cloud: "aws",
    description:
      "Nodes can reach AWS itself but not the internet. ECR works, Docker Hub and quay.io do not, and a Harness delegate cannot register.",
    requiresCluster: true,
  },
  {
    id: "azure-cluster",
    label: "Kubernetes cluster",
    cloud: "azure",
    description:
      "Builds each competitor an AKS cluster in their own resource group. On its own that is all it does — a working cluster and nothing wrong with it. Every scenario below needs one, and turns it on automatically.",
    providesCluster: true,
  },
  {
    id: "azure-connectivity-egress",
    label: "Connectivity: Egress",
    cloud: "azure",
    description:
      "Nodes can reach Azure itself but not the internet. Microsoft's registries work, Docker Hub and quay.io do not, and a Harness delegate cannot register.",
    requiresCluster: true,
  },
] as const satisfies readonly {
  id: string;
  label: string;
  cloud: ScenarioCloud;
  description: string;
  /** Selecting this builds the cluster layer; it has no Terraform of its own. */
  providesCluster?: true;
  /** Needs a cluster, so it pulls the cloud's cluster scenario in with it. */
  requiresCluster?: true;
}[];

export type Scenario = (typeof SCENARIOS)[number];

export type ScenarioId = (typeof SCENARIOS)[number]["id"];

export const scenariosForCloud = (cloud: ScenarioCloud) =>
  SCENARIOS.filter((s) => s.cloud === cloud);

/**
 * The scenarios on offer for a selection of clouds. A challenge runs on exactly
 * one cloud, so in practice this is that cloud's list; an empty selection
 * offers nothing, which is what makes the checkboxes appear only once a cloud
 * has been picked.
 */
export const scenariosForClouds = (clouds: readonly ScenarioCloud[]) =>
  SCENARIOS.filter((s) => clouds.includes(s.cloud));

export const isScenarioId = (v: string): v is ScenarioId =>
  SCENARIOS.some((s) => s.id === v);

/** The scenario that builds a cloud's clusters, if that cloud has one. */
export const clusterScenarioFor = (cloud: ScenarioCloud) =>
  SCENARIOS.find((s) => s.cloud === cloud && "providesCluster" in s);

const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);

/** Does this selection include something that cannot run without a cluster? */
export function needsClusterScenario(
  ids: readonly string[],
  cloud: ScenarioCloud,
): boolean {
  return ids.some((id) => {
    const s = scenarioById(id);
    return s?.cloud === cloud && "requiresCluster" in s;
  });
}

/**
 * Normalise a scenario selection: anything that needs a cluster brings that
 * cloud's cluster scenario in with it.
 *
 * Applied in the UI so the checkbox ticks itself where the organizer can see
 * it, and **again in the API**, because a selection that asks to break a
 * cluster without building one is not a state worth being able to store — and
 * the UI is not the only way to reach the API.
 */
export function withClusterScenario<T extends string>(
  ids: readonly T[],
  clouds: readonly ScenarioCloud[],
): T[] {
  const out = new Set<string>(ids);
  for (const cloud of clouds) {
    if (!needsClusterScenario(ids, cloud)) continue;
    const cluster = clusterScenarioFor(cloud);
    if (cluster) out.add(cluster.id);
  }
  // Catalog order, so the cluster sorts to the top of its cloud's group.
  return SCENARIOS.filter((s) => out.has(s.id)).map((s) => s.id) as T[];
}

/**
 * Whether the cluster checkbox should be locked on: something depending on it
 * is selected, so turning it off would describe a challenge that cannot be
 * built.
 */
export function clusterScenarioLocked(
  ids: readonly string[],
  clouds: readonly ScenarioCloud[],
): boolean {
  return clouds.some((cloud) => needsClusterScenario(ids, cloud));
}
