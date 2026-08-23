import { loadCatalog, log, recordResource, type Component, type RunRow } from "./db.js";
import {
  createConnector,
  upsertSecretFile,
  upsertSecretText,
} from "./harness.js";

/**
 * The Harness component catalog: the secrets, connectors, and templates every
 * workshop org gets, applied in dependency order.
 *
 * This replaces three hand-written `link<Cloud>ToHarness` routines whose
 * ordering was given by where their calls sat in `run.ts`. Source order is a
 * fine way to express "secret, then connector" and no way at all to express a
 * template that uses a connector that uses a secret, which is what workshops
 * actually need — let alone one contributed by somebody who cannot edit this
 * file.
 *
 * Two properties carry the design:
 *
 *   1. **Everything upserts.** Every create in the Harness client treats a
 *      duplicate as success, and secrets overwrite. So the whole catalog can be
 *      applied repeatedly and converges rather than erroring.
 *
 *   2. **Applying is therefore re-entrant.** That matters because half the
 *      inputs do not exist when provisioning starts: a cloud credential is
 *      minted by a Terraform apply that runs long after the org is created. So
 *      `applyCatalog` runs after the org is made and again after every apply,
 *      each pass creating whatever has become possible and leaving the rest
 *      pending. There is no scheduler and nothing to wait on.
 */

/* ------------------------------------------------------------------ *
 * Bindings — the parts of a spec only a run knows
 * ------------------------------------------------------------------ */

/**
 * What `${...}` in a component's spec can name.
 *
 * `outputs` is the accumulated Terraform output of every apply so far, and is
 * where cloud credentials arrive. It is deliberately passed in rather than read
 * from `run.outputs`: the credentials must never be stored, so the caller holds
 * them alongside the outputs it does persist and merges the two only here.
 */
export type Bindings = {
  org: { id: string };
  run: { id: string; name: string; slug: string };
  outputs: Record<string, unknown>;
};

/** A `${...}` reference, e.g. `${outputs.harness_gcp_key_json}`. */
const BINDING = /\$\{([a-zA-Z_][\w.]*)\}/g;

/**
 * The value a binding path names, or undefined when it resolves to nothing.
 *
 * An empty string counts as nothing on purpose. Terraform renders a disabled
 * optional output as `""` rather than omitting it — that is exactly how a
 * switched-off connector's credential arrives — and a secret created from an
 * empty string is worse than one not created at all.
 */
export function lookupBinding(path: string, b: Bindings): unknown {
  let cursor: unknown = b;
  for (const part of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  if (cursor === undefined || cursor === null) return undefined;
  if (typeof cursor === "string" && cursor.length === 0) return undefined;
  return cursor;
}

/** Raised when a spec references something no binding provides. */
class MissingBinding extends Error {
  constructor(identifier: string, path: string) {
    super(`component "${identifier}" references \${${path}}, which this run has no value for`);
    this.name = "MissingBinding";
  }
}

/**
 * Substitute every `${...}` in a spec, returning a payload ready to send.
 *
 * A string that is *only* a binding takes the value's own type, so a spec can
 * carry a number or a nested object through. Anything else interpolates as
 * text, which is what a spec wanting `projects/${outputs.gcp_project_id}/x`
 * needs.
 */
export function resolveBindings<T>(spec: T, b: Bindings, identifier: string): T {
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") {
      const whole = value.match(/^\$\{([a-zA-Z_][\w.]*)\}$/);
      if (whole) {
        const resolved = lookupBinding(whole[1]!, b);
        if (resolved === undefined) throw new MissingBinding(identifier, whole[1]!);
        return resolved;
      }
      return value.replace(BINDING, (_, path: string) => {
        const resolved = lookupBinding(path, b);
        if (resolved === undefined) throw new MissingBinding(identifier, path);
        return String(resolved);
      });
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v)]),
      );
    }
    return value;
  };
  return walk(spec) as T;
}

/* ------------------------------------------------------------------ *
 * The dependency graph
 * ------------------------------------------------------------------ */

/**
 * An `org.<identifier>` reference anywhere inside a spec — how Harness names a
 * thing in the enclosing organization, and so how one component names another.
 * It covers a connector's `secretKeyRef`, a pipeline's `connectorRef`, and a
 * template's `templateRef` without needing to know which of those it is
 * looking at.
 */
const ORG_REF = /\borg\.([a-zA-Z_][\w$]*)/g;

/**
 * Everything a component must be created after: what it declares, plus every
 * `org.<id>` in its spec that names another component in this catalog.
 *
 * Inference is not a convenience. A contributor who writes `org.gcp` in a
 * connector reference has already said what they depend on, and requiring them
 * to repeat it in `dependsOn` only creates a second thing to get wrong — one
 * that fails as a mis-ordered apply rather than as an error anyone can read.
 *
 * References that name nothing in the catalog are ignored rather than treated
 * as a dangling dependency: `org.harnessSecretManager` is the built-in Harness
 * secret manager, and an org can hold entities this catalog did not create.
 */
export function dependenciesOf(c: Component, known: Set<string>): string[] {
  const deps = new Set<string>();
  for (const declared of c.dependsOn) {
    if (declared !== c.identifier) deps.add(declared);
  }
  for (const [, id] of JSON.stringify(c.spec).matchAll(ORG_REF)) {
    // A component may legitimately mention its own identifier; that is not a
    // dependency on itself, and treating it as one would deadlock the sort.
    if (known.has(id!) && id !== c.identifier) deps.add(id!);
  }
  return [...deps];
}

export type Graph = {
  /** Components in an order where every dependency precedes its dependents. */
  order: Component[];
  /** Resolved dependencies, by identifier. */
  deps: Map<string, string[]>;
};

/**
 * Order the catalog so nothing is created before what it references.
 *
 * Kahn's algorithm, taking ready components in identifier order so the same
 * catalog always applies in the same sequence — a run log that differs between
 * two identical workshops is a run log nobody can diff.
 *
 * A cycle throws, naming its members. It cannot be resolved at apply time and
 * it is always a mistake in the catalog, so failing loudly with the names is
 * the most useful thing available.
 */
export function buildGraph(components: Component[]): Graph {
  const known = new Set(components.map((c) => c.identifier));
  const byId = new Map(components.map((c) => [c.identifier, c]));
  const deps = new Map(components.map((c) => [c.identifier, dependenciesOf(c, known)]));

  const missing = new Map<string, string[]>();
  for (const [id, list] of deps) {
    const absent = list.filter((d) => !known.has(d));
    if (absent.length) missing.set(id, absent);
  }
  if (missing.size) {
    const detail = [...missing]
      .map(([id, absent]) => `${id} -> ${absent.join(", ")}`)
      .join("; ");
    throw new Error(`component catalog has unresolvable dependencies: ${detail}`);
  }

  const remaining = new Set(known);
  const order: Component[] = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter((id) => deps.get(id)!.every((d) => !remaining.has(d)))
      .sort();
    if (ready.length === 0) {
      throw new Error(
        `component catalog has a dependency cycle among: ${[...remaining].sort().join(", ")}`,
      );
    }
    for (const id of ready) {
      order.push(byId.get(id)!);
      remaining.delete(id);
    }
  }

  return { order, deps };
}

/* ------------------------------------------------------------------ *
 * Applying
 * ------------------------------------------------------------------ */

/** What became of one component on one pass. */
type State = "applied" | "pending";

export type ApplyResult = {
  applied: string[];
  /** Identifiers whose inputs this run does not have — not an error. */
  pending: string[];
};

/**
 * The resource row kind for each component kind, so the run page groups them
 * the way an organizer thinks about them.
 */
const RESOURCE_KIND: Record<Component["kind"], string> = {
  secret_text: "harness_secret",
  secret_file: "harness_secret",
  connector: "harness_connector",
};

/** Create one component in the workshop's org. */
async function applyComponent(
  c: Component,
  orgId: string,
  b: Bindings,
): Promise<boolean> {
  if (c.scope !== "org") {
    throw new Error(
      `component "${c.identifier}" has scope "${c.scope}"; only org scope is supported so far`,
    );
  }

  const spec = resolveBindings(c.spec, b, c.identifier) as Record<string, unknown>;

  switch (c.kind) {
    case "secret_text":
      return upsertSecretText(orgId, c.identifier, c.name, String(spec.value ?? ""));
    case "secret_file":
      return upsertSecretFile(orgId, c.identifier, c.name, String(spec.content ?? ""));
    case "connector":
      return createConnector(
        orgId,
        c.identifier,
        c.name,
        String(spec.type ?? ""),
        (spec.spec ?? {}) as Record<string, unknown>,
      );
    default: {
      // Exhaustive today; the guard is what turns a future kind added to the
      // schema but not here into a clear error instead of a silent skip.
      const kind: never = c.kind;
      throw new Error(`component "${c.identifier}" has unknown kind "${kind}"`);
    }
  }
}

/**
 * Apply the whole catalog to a run's Harness org, in dependency order.
 *
 * Safe to call as often as there is new information — after the org is created,
 * and again after each cloud's apply. Everything upserts, so a component that
 * already landed is re-confirmed rather than duplicated, and one whose inputs
 * have only just arrived is created on the pass that first sees them.
 *
 * ## When a missing input is an error
 *
 * A component that cannot be created is usually not a problem: a workshop with
 * no AWS in it has no AWS credential, so the AWS secret and the connector above
 * it simply do not apply. But "no credential" and "a credential arrived broken"
 * must not look the same, and before this was data the difference was two
 * hand-written branches — a silent `return` for the absent key, an explicit
 * `throw` for an Azure client secret that came back without its tenant id.
 *
 * The rule that reproduces both, without either being written per component:
 *
 *   * dependencies pending, or none, and own requirements unmet — **pending**.
 *     Nothing upstream happened, so nothing was expected to.
 *   * every dependency applied, own requirements unmet — **error**. Its inputs
 *     were built and it still cannot be created, which is a broken run.
 *
 * So a whole cloud being absent goes quiet, and a cloud that half-arrived is
 * loud, which is exactly the behaviour the two branches used to encode.
 */
export async function applyCatalog(
  run: RunRow,
  orgId: string,
  outputs: Record<string, unknown>,
): Promise<ApplyResult> {
  const components = await loadCatalog();
  if (components.length === 0) return { applied: [], pending: [] };

  const { order, deps } = buildGraph(components);
  const bindings: Bindings = {
    org: { id: orgId },
    run: { id: run.id, name: run.name, slug: run.slug },
    outputs,
  };

  const state = new Map<string, State>();
  const applied: string[] = [];
  const pending: string[] = [];

  for (const c of order) {
    const unmet = c.requires.filter((p) => lookupBinding(p, bindings) === undefined);
    const dependencies = deps.get(c.identifier)!;
    const allDepsApplied = dependencies.every((d) => state.get(d) === "applied");

    if (unmet.length > 0) {
      if (dependencies.length > 0 && allDepsApplied) {
        throw new Error(
          `Harness component "${c.identifier}" cannot be created: everything it ` +
            `depends on (${dependencies.join(", ")}) was built, but this run has ` +
            `no value for ${unmet.join(", ")}`,
        );
      }
      state.set(c.identifier, "pending");
      pending.push(c.identifier);
      continue;
    }

    if (!allDepsApplied) {
      state.set(c.identifier, "pending");
      pending.push(c.identifier);
      continue;
    }

    const existed = await applyComponent(c, orgId, bindings);
    state.set(c.identifier, "applied");
    applied.push(c.identifier);

    await log(
      run.id,
      "stdout",
      `${c.kind} ${c.identifier} ${existed ? "updated" : "created"}` +
        (dependencies.length ? ` -> ${dependencies.join(", ")}` : ""),
    );
    await recordResource(run.id, {
      kind: RESOURCE_KIND[c.kind],
      key: c.identifier,
      label: c.name,
      detail: `${c.identifier} (org ${orgId})`,
    });
  }

  return { applied, pending };
}

/**
 * The catalog in teardown order: dependents before what they depend on.
 *
 * Harness refuses to delete a secret a connector still references, so the
 * reverse of the apply order is not merely tidy — it is the order that works.
 * Deriving it from the same graph is what keeps teardown correct as the catalog
 * grows, which a hand-written list of cloud triples could never do.
 */
export async function teardownOrder(): Promise<Component[]> {
  const components = await loadCatalog();
  if (components.length === 0) return [];
  return buildGraph(components).order.reverse();
}
