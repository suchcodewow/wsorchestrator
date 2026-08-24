/**
 * What each component references, for showing the catalog.
 *
 * ## Why this exists twice
 *
 * This mirrors `dependenciesOf` in the runner's `components.ts`, which is the
 * authority: it is what actually orders the creates. The runner is a Cloud Run
 * job invoked with environment overrides, and the two packages build from
 * separate Docker contexts, so the portal cannot call it and cannot import it.
 *
 * Duplicating the *ordering* would be indefensible — two topological sorts that
 * drift make "it validated" stop meaning "it will apply", which is why
 * validation is split the way it is. Duplicating this is a smaller thing: one
 * regex and a set membership test, whose correctness is visible in ten lines
 * rather than argued about. It is display only. Nothing here decides whether a
 * component may be created or in what order.
 *
 * Deliberately free of imports, so a test in the runner's package can load both
 * implementations and check they agree on the same fixtures. If you change the
 * pattern below, change it there too, and that test will tell you if you did
 * not.
 */

/**
 * An `org.<identifier>` reference anywhere inside a spec — how Harness names a
 * thing in the enclosing organization, and so how one component names another.
 * Covers a connector's `secretKeyRef`, a template's `templateRef`, and a
 * pipeline's `connectorRef` without knowing which it is looking at.
 */
const ORG_REF = /\borg\.([a-zA-Z_][\w$]*)/g;

/** The minimum a component needs for its references to be worked out. */
export type ReferencingComponent = {
  identifier: string;
  spec: unknown;
  dependsOn: string[];
};

/**
 * Everything a component must be created after: what it declares, plus every
 * `org.<id>` in its spec naming another component in this catalog.
 *
 * References naming nothing in the catalog are ignored rather than treated as
 * dangling: `org.harnessSecretManager` is a Harness built-in, and an
 * organization can hold entities this catalog did not create.
 */
export function dependenciesOf(
  c: ReferencingComponent,
  known: Set<string>,
): string[] {
  const deps = new Set<string>();
  for (const declared of c.dependsOn) {
    if (declared !== c.identifier) deps.add(declared);
  }
  for (const [, id] of JSON.stringify(c.spec).matchAll(ORG_REF)) {
    // A component may mention its own identifier; that is not a dependency on
    // itself, and treating it as one would deadlock the runner's sort.
    if (known.has(id!) && id !== c.identifier) deps.add(id!);
  }
  return [...deps];
}

/** For each component, what it references and what references it. */
export function referenceMap(components: ReferencingComponent[]): {
  dependsOn: Map<string, string[]>;
  usedBy: Map<string, string[]>;
} {
  const known = new Set(components.map((c) => c.identifier));
  const dependsOn = new Map<string, string[]>();
  const usedBy = new Map<string, string[]>(
    components.map((c) => [c.identifier, [] as string[]]),
  );

  for (const c of components) {
    const deps = dependenciesOf(c, known);
    dependsOn.set(c.identifier, deps);
    for (const d of deps) usedBy.get(d)?.push(c.identifier);
  }

  return { dependsOn, usedBy };
}
