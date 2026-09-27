/**
 * Which component references which, as the Contribute page shows it.
 *
 * Dependencies are inferred from `org.<identifier>` references inside a spec —
 * a connector's `secretKeyRef: org.gcp_service_account`, a template's
 * `templateRef: org.deploy_base` — so a contributor never has to repeat them in
 * `dependsOn`. This is the frontend's copy of the rule the runner sorts the
 * catalog by (`runner/src/components.ts`); if the two disagree, the page tells
 * a contributor one thing about what their component needs and the apply does
 * another.
 *
 * The rules pinned here: declared and inferred dependencies merge without
 * duplicates; a reference to something outside the catalog
 * (`org.harnessSecretManager`, the Harness built-in) is ignored; a component
 * mentioning itself is not its own dependency.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { dependenciesOf, referenceMap, type ReferencingComponent } from "@/lib/components/graph";

const comp = (identifier: string, spec: unknown = {}, dependsOn: string[] = []): ReferencingComponent => ({
  identifier,
  spec,
  dependsOn,
});

const sorted = (xs: string[]) => [...xs].sort();

describe("dependenciesOf", () => {
  const known = new Set(["gcp_service_account", "gcp", "deploy_base", "deploy_to_gke"]);

  test("finds a connector's secretKeyRef", () => {
    const gcp = comp("gcp", {
      type: "Gcp",
      spec: { credential: { type: "ManualConfig", spec: { secretKeyRef: "org.gcp_service_account" } } },
    });
    assert.deepEqual(dependenciesOf(gcp, known), ["gcp_service_account"]);
  });

  test("finds references inside template YAML, however deeply nested", () => {
    const t = comp("deploy_to_gke", {
      yaml: "template:\n  type: Stage\n  spec:\n    templateRef: org.deploy_base\n    connectorRef: org.gcp\n",
    });
    assert.deepEqual(sorted(dependenciesOf(t, known)), ["deploy_base", "gcp"]);
  });

  test("finds a reference inside a Harness expression", () => {
    const t = comp("deploy_to_gke", { yaml: 'value: <+secrets.getValue("org.gcp_service_account")>' });
    assert.deepEqual(dependenciesOf(t, known), ["gcp_service_account"]);
  });

  test("ignores references to things outside the catalog", () => {
    const s = comp("gcp", { secretManager: "org.harnessSecretManager", ref: "org.gcp_service_account" });
    assert.deepEqual(dependenciesOf(s, known), ["gcp_service_account"]);
  });

  test("a component referring to itself does not depend on itself", () => {
    const self = comp("gcp", { note: "org.gcp" }, ["gcp"]);
    assert.deepEqual(dependenciesOf(self, known), []);
  });

  test("declared dependencies are kept even when unknown, and merged with inferred ones once each", () => {
    const c = comp("deploy_to_gke", { ref: "org.gcp", again: "org.gcp" }, ["gcp", "something_external"]);
    assert.deepEqual(sorted(dependenciesOf(c, known)), ["gcp", "something_external"]);
  });

  test("does not match org. inside a longer word, or a prefix of a known identifier", () => {
    const c = comp("deploy_to_gke", { a: "myorg.gcp", b: "org.gcpx", c: "org.deploy_base_v2" });
    assert.deepEqual(dependenciesOf(c, new Set(["gcp", "deploy_base"])), []);
  });

  test("matches after punctuation such as a dot or quote", () => {
    const c = comp("deploy_to_gke", { a: "account.org.gcp", b: "'org.deploy_base'" });
    assert.deepEqual(sorted(dependenciesOf(c, known)), ["deploy_base", "gcp"]);
  });

  test("identifiers containing $ are matched whole", () => {
    const c = comp("x", { ref: "org.a$b" });
    assert.deepEqual(dependenciesOf(c, new Set(["a$b", "a"])), ["a$b"]);
  });

  test("an empty spec and no declarations means no dependencies", () => {
    assert.deepEqual(dependenciesOf(comp("gcp"), known), []);
  });

  test(
    "a hyphenated secret identifier is matched whole",
    {
      todo:
        "ORG_REF stops at a hyphen, but secret identifiers may contain one (validate.ts SECRET_IDENTIFIER). " +
        "`secretKeyRef: org.gcp-key` yields no dependency on `gcp-key`, so the connector can be created " +
        "before its secret. The same regex is in runner/src/components.ts:127.",
    },
    () => {
      const c = comp("gcp", { secretKeyRef: "org.gcp-key" });
      assert.deepEqual(dependenciesOf(c, new Set(["gcp-key", "gcp"])), ["gcp-key"]);
    },
  );

  test(
    "a hyphenated reference does not match a shorter known identifier",
    {
      todo:
        "`org.gcp-key` is read as a reference to `gcp`, so a component that names secret `gcp-key` is " +
        "reported as depending on connector `gcp`.",
    },
    () => {
      const c = comp("deploy_to_gke", { secretKeyRef: "org.gcp-key" });
      assert.deepEqual(dependenciesOf(c, new Set(["gcp", "gcp-key"])), ["gcp-key"]);
    },
  );
});

describe("referenceMap", () => {
  const catalog = [
    comp("gcp_service_account", { value: "${outputs.harness_gcp_key_json}" }),
    comp("gcp", { spec: { secretKeyRef: "org.gcp_service_account" } }),
    comp("deploy_base", { yaml: "template:\n  connectorRef: org.gcp" }),
    comp("deploy_to_gke", { yaml: "template:\n  templateRef: org.deploy_base\n  connectorRef: org.gcp" }),
  ];

  test("gives every component a dependsOn entry", () => {
    const { dependsOn } = referenceMap(catalog);
    assert.deepEqual(Object.fromEntries([...dependsOn].map(([k, v]) => [k, sorted(v)])), {
      gcp_service_account: [],
      gcp: ["gcp_service_account"],
      deploy_base: ["gcp"],
      deploy_to_gke: ["deploy_base", "gcp"],
    });
  });

  test("usedBy is the inverse, with an empty list for anything nobody uses", () => {
    const { usedBy } = referenceMap(catalog);
    assert.deepEqual(Object.fromEntries([...usedBy].map(([k, v]) => [k, sorted(v)])), {
      gcp_service_account: ["gcp"],
      gcp: ["deploy_base", "deploy_to_gke"],
      deploy_base: ["deploy_to_gke"],
      deploy_to_gke: [],
    });
  });

  test("a declared dependency on something outside the list is kept in dependsOn but has no usedBy entry", () => {
    const { dependsOn, usedBy } = referenceMap([comp("a", {}, ["external"])]);
    assert.deepEqual(dependsOn.get("a"), ["external"]);
    assert.equal(usedBy.has("external"), false);
  });

  test("a reference only counts against the components in this list", () => {
    const { dependsOn } = referenceMap([comp("gcp", { ref: "org.gcp_service_account" })]);
    assert.deepEqual(dependsOn.get("gcp"), []);
  });

  test("cycles are reported as they are, not resolved", () => {
    const { dependsOn, usedBy } = referenceMap([comp("a", { r: "org.b" }), comp("b", { r: "org.a" })]);
    assert.deepEqual(dependsOn.get("a"), ["b"]);
    assert.deepEqual(dependsOn.get("b"), ["a"]);
    assert.deepEqual(usedBy.get("a"), ["b"]);
    assert.deepEqual(usedBy.get("b"), ["a"]);
  });

  test("an empty catalog gives empty maps", () => {
    const { dependsOn, usedBy } = referenceMap([]);
    assert.equal(dependsOn.size, 0);
    assert.equal(usedBy.size, 0);
  });
});
