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

export const SCENARIOS = [
  {
    id: "gcp-connectivity-egress",
    label: "Connectivity: Egress",
    cloud: "gcp",
    description:
      "Cluster nodes cannot reach the internet. Pods stay in ImagePullBackOff against Docker Hub and quay.io, and a Harness delegate cannot register.",
  },
  {
    id: "gcp-connectivity-binauthz",
    label: "Connectivity: Binary Auth",
    cloud: "gcp",
    description:
      "Only images from the competitor's own registries are admitted. Anything else is denied at pod admission and never pulled.",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  cloud: ScenarioCloud;
  description: string;
}[];

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
