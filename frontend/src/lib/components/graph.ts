/** Works out what order components must be created in. */

const ORG_REF = /\borg\.([a-zA-Z_][\w$]*)/g;

export type ReferencingComponent = {
  identifier: string;
  spec: unknown;
  dependsOn: string[];
};

export function dependenciesOf(
  c: ReferencingComponent,
  known: Set<string>,
): string[] {
  const deps = new Set<string>();
  for (const declared of c.dependsOn) {
    if (declared !== c.identifier) deps.add(declared);
  }
  for (const [, id] of JSON.stringify(c.spec).matchAll(ORG_REF)) {
    if (known.has(id!) && id !== c.identifier) deps.add(id!);
  }
  return [...deps];
}

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
