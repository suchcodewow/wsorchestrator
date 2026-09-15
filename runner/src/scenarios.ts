/**
 * The scenario catalog — optional Terraform an organizer layers onto a
 * challenge with a checkbox.
 *
 * A scenario is a directory under `terraform/scenarios/` holding a root config
 * and a `scenario.json` describing it. The manifest is the source of truth, and
 * reading it from disk means adding a scenario is adding a directory: nothing
 * here enumerates them.
 *
 * The frontend cannot read this directory — the two images are built from
 * different Docker contexts — so `SCENARIOS` in the frontend's Drizzle schema
 * mirrors these manifests, and `test/scenario-catalog.test.ts` fails if the two
 * ever disagree. That test is the only thing keeping the mirror honest, which
 * is why it exists.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TF_ROOT } from "./config.js";
import type { Cloud } from "./db.js";

/** Where the scenario roots live, relative to `TF_ROOT`. */
const SCENARIOS_DIR = "scenarios";

export type Scenario = {
  id: string;
  label: string;
  cloud: Cloud;
  description: string;
  /** Build the per-competitor cluster layer before applying this. */
  requiresCluster: boolean;
  /** APIs this scenario needs enabled in each competitor's project. */
  activateApis: string[];
  /**
   * This scenario *is* the cluster: selecting it turns that cloud's cluster
   * layer on, and it has no Terraform root of its own.
   *
   * It exists so an organizer can hand competitors a working cluster without
   * also breaking something about it. Everything with `requiresCluster` pulls
   * it in automatically — see `withClusterScenario` in the frontend catalog,
   * which both the UI and the API enforce.
   */
  providesCluster: boolean;
  /**
   * Apply this root once per competitor instead of once for the roster.
   *
   * Needed whenever the scenario cannot be expressed as a `for_each` in a single
   * apply — an AWS scenario, because each competitor's account needs its own
   * assumed-role provider, or any scenario reaching inside a cluster, because
   * the `kubernetes` and `helm` providers cannot be instantiated per-cluster.
   *
   * The runner applies these concurrently, each against a private copy of the
   * root and its own state prefix.
   */
  perCompetitor: boolean;
};

const CLOUDS: readonly Cloud[] = ["aws", "azure", "gcp"];

function parseManifest(dir: string, raw: string): Scenario {
  const m = JSON.parse(raw) as Partial<Scenario>;

  // A malformed manifest is a packaging error, not a runtime condition to
  // tolerate: a scenario the organizer selected but that cannot be read is a
  // challenge that would come up quietly missing its issues.
  if (m.id !== dir) {
    throw new Error(
      `scenario ${dir}: manifest id is ${JSON.stringify(m.id)}, which must ` +
        `equal the directory name — the id is the state prefix, so they cannot diverge`,
    );
  }
  if (typeof m.label !== "string" || m.label.length === 0) {
    throw new Error(`scenario ${dir}: manifest needs a label`);
  }
  if (!m.cloud || !CLOUDS.includes(m.cloud)) {
    throw new Error(
      `scenario ${dir}: manifest cloud is ${JSON.stringify(m.cloud)}, ` +
        `expected one of ${CLOUDS.join(", ")}`,
    );
  }

  return {
    id: m.id,
    label: m.label,
    cloud: m.cloud,
    description: typeof m.description === "string" ? m.description : "",
    requiresCluster: m.requiresCluster === true,
    activateApis: Array.isArray(m.activateApis) ? m.activateApis : [],
    perCompetitor: m.perCompetitor === true,
    providesCluster: m.providesCluster === true,
  };
}

/**
 * Read every manifest on disk. Cached after the first call — the directory does
 * not change under a running job, and the reaper and the provisioner both ask.
 */
let cache: Map<string, Scenario> | undefined;

export function allScenarios(): Map<string, Scenario> {
  if (cache) return cache;

  const root = path.join(TF_ROOT, SCENARIOS_DIR);
  const found = new Map<string, Scenario>();

  // No directory at all is a legitimate state (a deployment that ships no
  // scenarios), so it reads as an empty catalog rather than an error.
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = path.join(root, entry.name, "scenario.json");
      if (!fs.existsSync(manifest)) continue;
      found.set(
        entry.name,
        parseManifest(entry.name, fs.readFileSync(manifest, "utf8")),
      );
    }
  }

  cache = found;
  return found;
}

/** Only used by the tests, which build catalogs from fixture directories. */
export function clearScenarioCache(): void {
  cache = undefined;
}

/** One scenario by id, or undefined if this build does not ship it. */
export function scenarioById(id: string): Scenario | undefined {
  return allScenarios().get(id);
}

/** The scenarios offered for a cloud, in a stable order. */
export function scenariosFor(cloud: Cloud): Scenario[] {
  return [...allScenarios().values()]
    .filter((s) => s.cloud === cloud)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Resolve the ids stored on a run to manifests, dropping any that no longer
 * exist.
 *
 * A run outlives the code that provisioned it: a scenario removed from the repo
 * leaves its id behind on runs that selected it. Skipping those rather than
 * throwing means such a run can still be grown and still be torn down — the
 * layer's state is orphaned either way, and failing here would stop the teardown
 * that cleans up everything else.
 */
export function resolveScenarios(ids: readonly string[]): Scenario[] {
  const all = allScenarios();
  return ids.flatMap((id) => {
    const s = all.get(id);
    return s ? [s] : [];
  });
}

/** Ids on the run that no longer have a manifest, for logging. */
export function unknownScenarios(ids: readonly string[]): string[] {
  const all = allScenarios();
  return ids.filter((id) => !all.has(id));
}

/**
 * Whether any of these scenarios needs the per-competitor cluster layer built —
 * either because it breaks one, or because it *is* one.
 */
export function needsCluster(scenarios: readonly Scenario[]): boolean {
  return scenarios.some((s) => s.requiresCluster || s.providesCluster);
}

/**
 * Whether this scenario has Terraform of its own to apply.
 *
 * A `providesCluster` scenario does not: the cluster layer builds the cluster,
 * and the manifest exists only so the organizer can ask for one. Applying a
 * layer for it would create an empty state object and nothing else.
 */
export function hasScenarioRoot(scenario: Scenario): boolean {
  return !scenario.providesCluster;
}

/**
 * The APIs to enable in every competitor's project: the baseline plus whatever
 * the selected scenarios need. A challenge with no scenarios gets exactly the
 * baseline, so its projects are unchanged from before scenarios existed.
 */
export function activateApisFor(
  baseline: readonly string[],
  scenarios: readonly Scenario[],
): string[] {
  return [...new Set([...baseline, ...scenarios.flatMap((s) => s.activateApis)])];
}

/**
 * The state prefix a scenario's layer lives on, under the run's.
 *
 * A per-competitor scenario passes `slug` and gets one prefix each, so its
 * applies never share state — which is what lets them run at the same time, and
 * what lets one competitor's environment be rebuilt without touching another's.
 */
export function scenarioStatePrefix(
  base: string,
  id: string,
  slug?: string,
): string {
  const root = `${base}/scenarios/${id}`;
  return slug ? `${root}/${slug}` : root;
}

/**
 * A competitor's short, stable identifier, derived from their address.
 *
 * The same six hex characters `makeChallengeProjectId` already appends to a
 * project id, lifted out so the state prefixes, working-directory names and
 * resource names all agree on who a competitor is. Derived from the address
 * rather than a roster position for the reason given there: a challenge that
 * grows must not renumber the competitors already in it.
 */
export function competitorSlug(email: string): string {
  return createHash("sha1").update(email).digest("hex").slice(0, 6);
}

/** The working-directory name for one competitor's copy of a scenario root. */
export function scenarioWorkName(
  runId: string,
  scenarioId: string,
  slug: string,
): string {
  return `${runId.replace(/-/g, "").slice(0, 8)}-${scenarioId}-${slug}`;
}

/** The state prefix the per-competitor cluster layer lives on. */
export function clusterStatePrefix(base: string): string {
  return `${base}/cluster`;
}

/** The root config directory for a scenario, relative to `TF_ROOT`. */
export function scenarioTfSource(id: string): string {
  return `${SCENARIOS_DIR}/${id}`;
}

/**
 * The scenario layers a run has actually built, from its recorded outputs.
 *
 * The provisioner reconciles against this rather than against the catalog, and
 * the reaper destroys it rather than what the organizer last selected — the two
 * differ when a scenario was unchecked and the reprovision that would have
 * removed it failed, and it is the standing one that has to go.
 *
 * Absent on every run that predates scenarios and on every run that never had
 * one, which reads correctly as "none standing".
 */
export function appliedScenarios(
  outputs: Record<string, unknown> | null,
): string[] {
  const v = outputs?.scenarios_applied;
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}
