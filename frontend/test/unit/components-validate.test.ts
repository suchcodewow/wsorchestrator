/**
 * The gate a contributed Harness component passes before it is stored.
 *
 * Everything this rejects would otherwise be rejected later by Harness itself,
 * in the middle of a workshop's apply, as an error an organizer has to read in
 * a run log: an identifier with a hyphen, a template whose YAML does not start
 * at `template:`, a component named `status` that the expression language
 * swallows. Catching it here turns a failed event into a message the
 * contributor sees at submit time — so these tests pin both what is refused
 * and that the message names the field to fix.
 *
 * The reserved words below are copied from the contributor bundle's SKILL.md,
 * which promises contributors exactly that list; the test holds the validator
 * to the promise.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SET_COMPONENTS,
  validateComponent,
  validateSet,
  type SubmittedComponent,
} from "@/lib/components/validate";

const RESERVED_IN_SKILL_MD =
  "or and eq ne lt gt le ge div mod not null true false new var return step parallel stepgroup org account status liteenginetask notification".split(
    " ",
  );

const connector = (over: SubmittedComponent = {}): SubmittedComponent => ({
  identifier: "gcp",
  kind: "connector",
  scope: "org",
  name: "GCP",
  spec: { type: "Gcp", spec: { credential: { type: "ManualConfig" } } },
  ...over,
});

const fields = (c: SubmittedComponent) =>
  validateComponent(c, 0).issues.map((i) => i.field);

describe("validateComponent: a well-formed component", () => {
  test("is accepted with defaults filled in", () => {
    const { issues, valid } = validateComponent(connector(), 3);
    assert.deepEqual(issues, []);
    assert.deepEqual(valid, {
      identifier: "gcp",
      kind: "connector",
      scope: "org",
      name: "GCP",
      description: "",
      spec: { type: "Gcp", spec: { credential: { type: "ManualConfig" } } },
      requires: [],
      dependsOn: [],
      versionLabel: "1",
    });
  });

  test("keeps the optional fields it was given, and trims the name", () => {
    const { valid } = validateComponent(
      connector({
        name: "  GCP connector  ",
        description: "The workshop's GCP connector",
        requires: ["outputs.harness_gcp_key_json"],
        dependsOn: ["gcp_service_account"],
        versionLabel: "3",
      }),
      0,
    );
    assert.equal(valid?.name, "GCP connector");
    assert.equal(valid?.description, "The workshop's GCP connector");
    assert.deepEqual(valid?.requires, ["outputs.harness_gcp_key_json"]);
    assert.deepEqual(valid?.dependsOn, ["gcp_service_account"]);
    assert.equal(valid?.versionLabel, "3");
  });

  test("an empty versionLabel falls back to 1", () => {
    assert.equal(validateComponent(connector({ versionLabel: "" }), 0).valid?.versionLabel, "1");
  });

  test("a non-string description is dropped rather than rejected", () => {
    assert.equal(validateComponent(connector({ description: 42 }), 0).valid?.description, "");
  });

  test("each kind is accepted with the spec field it needs", () => {
    const cases: SubmittedComponent[] = [
      { kind: "secret_text", spec: { value: "${outputs.token}" } },
      { kind: "secret_file", spec: { content: "${outputs.harness_gcp_key_json}" } },
      { kind: "connector", spec: { type: "Gcp" } },
      { kind: "template", spec: { yaml: "template:\n  type: Stage\n" } },
    ];
    for (const c of cases) {
      const { issues } = validateComponent(connector(c), 0);
      assert.deepEqual(issues, [], String(c.kind));
    }
  });
});

describe("validateComponent: identifier", () => {
  test("is required", () => {
    for (const identifier of [undefined, null, "", 7]) {
      const { issues, valid } = validateComponent(connector({ identifier }), 0);
      assert.equal(valid, null);
      assert.deepEqual(
        issues.map((i) => [i.field, i.message]),
        [["identifier", "is required"]],
      );
    }
  });

  test("accepts letters, digits, underscores and dollars after a letter or underscore", () => {
    for (const id of ["a", "_", "_x9", "deploy_to_gke", "A$b", "x".repeat(128)]) {
      assert.deepEqual(fields(connector({ identifier: id })), [], id);
    }
  });

  test("rejects a leading digit or dollar, hyphens, dots, spaces, and anything over 128", () => {
    for (const id of ["9lives", "$x", "my-connector", "a.b", "a b", "x".repeat(129), "café"]) {
      const { issues } = validateComponent(connector({ identifier: id }), 0);
      assert.deepEqual(issues.map((i) => i.field), ["identifier"], id);
      assert.match(issues[0]!.message, /is not a legal Harness identifier/);
    }
  });

  test("secrets may contain hyphens; nothing else may", () => {
    assert.deepEqual(
      fields({ identifier: "gcp-key", kind: "secret_text", scope: "org", name: "k", spec: { value: "v" } }),
      [],
    );
    assert.deepEqual(
      fields({ identifier: "gcp-key", kind: "secret_file", scope: "org", name: "k", spec: { content: "v" } }),
      [],
    );
    assert.deepEqual(fields(connector({ identifier: "gcp-key" })), ["identifier"]);
    assert.deepEqual(
      fields({ identifier: "gcp-key", kind: "template", scope: "org", name: "t", spec: { yaml: "template:" } }),
      ["identifier"],
    );
  });

  test("the rejection message mentions hyphens only where they are allowed", () => {
    const secret = validateComponent(
      { identifier: "1x", kind: "secret_text", scope: "org", name: "k", spec: { value: "v" } },
      0,
    ).issues[0]!.message;
    const other = validateComponent(connector({ identifier: "1x" }), 0).issues[0]!.message;
    assert.match(secret, /hyphens/);
    assert.doesNotMatch(other, /hyphens/);
  });

  test("a secret still cannot start with a hyphen", () => {
    assert.deepEqual(
      fields({ identifier: "-key", kind: "secret_text", scope: "org", name: "k", spec: { value: "v" } }),
      ["identifier"],
    );
  });

  test("every word the contributor guide calls reserved is refused, in any case", () => {
    for (const word of RESERVED_IN_SKILL_MD) {
      for (const id of [word, word.toUpperCase(), word[0]!.toUpperCase() + word.slice(1)]) {
        const { issues } = validateComponent(connector({ identifier: id }), 0);
        assert.equal(issues.length, 1, id);
        assert.match(issues[0]!.message, /reserved by the Harness expression language/, id);
      }
    }
  });

  test("a reserved word as part of a longer identifier is fine", () => {
    for (const id of ["org_secret", "status_page", "my_account", "notnull"]) {
      assert.deepEqual(fields(connector({ identifier: id })), [], id);
    }
  });
});

describe("validateComponent: kind, scope and name", () => {
  test("an unknown or missing kind is refused and names the choices", () => {
    for (const kind of [undefined, "pipeline", "Connector", 1]) {
      const { issues } = validateComponent(connector({ kind }), 0);
      const kindIssue = issues.find((i) => i.field === "kind");
      assert.ok(kindIssue, String(kind));
      assert.equal(kindIssue.message, "must be one of secret_text, secret_file, connector, template");
    }
  });

  test("without a kind the spec is not checked against a kind's field", () => {
    assert.deepEqual(fields(connector({ kind: "nope", spec: {} })), ["kind"]);
  });

  test("scope must be org; project is recognised but not supported yet", () => {
    assert.deepEqual(fields(connector({ scope: "account" })), ["scope"]);
    assert.deepEqual(fields(connector({ scope: undefined })), ["scope"]);
    const project = validateComponent(connector({ scope: "project" }), 0);
    assert.equal(project.valid, null);
    assert.match(project.issues[0]!.message, /not supported yet/);
  });

  test("name is required and must not be blank", () => {
    for (const name of [undefined, "", "   ", 5]) {
      assert.deepEqual(fields(connector({ name })), ["name"], String(name));
    }
  });
});

describe("validateComponent: spec", () => {
  test("must be a plain object", () => {
    for (const spec of [undefined, null, "yaml", [], 3]) {
      assert.deepEqual(fields(connector({ spec })), ["spec"], JSON.stringify(spec));
    }
  });

  test("a missing or empty kind field is named, with a hint", () => {
    const cases: Array<[string, string]> = [
      ["secret_text", "spec.value"],
      ["secret_file", "spec.content"],
      ["connector", "spec.type"],
      ["template", "spec.yaml"],
    ];
    for (const [kind, field] of cases) {
      for (const spec of [{}, { [field.slice(5)]: "" }, { [field.slice(5)]: 42 }]) {
        const { issues } = validateComponent(connector({ kind, spec }), 0);
        assert.deepEqual(issues.map((i) => i.field), [field], `${kind} ${JSON.stringify(spec)}`);
        assert.match(issues[0]!.message, new RegExp(`a ${kind} needs ${field.replace(".", "\\.")}`));
      }
    }
  });

  test("a template's YAML must open with template:", () => {
    const yaml = (y: string) => fields(connector({ kind: "template", spec: { yaml: y } }));
    assert.deepEqual(yaml("template:\n  type: Stage"), []);
    assert.deepEqual(yaml("\n\n  template:  \n  type: Stage"), [], "leading blank lines and spaces");
    assert.deepEqual(yaml("template:\r\n  type: Stage"), [], "CRLF line endings");
    assert.deepEqual(yaml("pipeline:\n  name: x"), ["spec.yaml"]);
    assert.deepEqual(yaml("name: x\ntemplate:\n"), ["spec.yaml"], "template: not first");
    assert.deepEqual(yaml("template: {}"), ["spec.yaml"], "inline value on the same line");
    assert.deepEqual(yaml("templates:"), ["spec.yaml"]);
  });
});

describe("validateComponent: optional arrays and versionLabel", () => {
  test("requires and dependsOn must be arrays of strings when present", () => {
    assert.deepEqual(fields(connector({ requires: "outputs.x" })), ["requires"]);
    assert.deepEqual(fields(connector({ requires: ["outputs.x", 1] })), ["requires"]);
    assert.deepEqual(fields(connector({ dependsOn: { a: 1 } })), ["dependsOn"]);
    assert.deepEqual(fields(connector({ dependsOn: [null] })), ["dependsOn"]);
    assert.deepEqual(fields(connector({ requires: [], dependsOn: [] })), []);
  });

  test("versionLabel must be a string when present", () => {
    assert.deepEqual(fields(connector({ versionLabel: 2 })), ["versionLabel"]);
  });
});

describe("validateComponent: reporting", () => {
  test("every problem is reported at once, each tagged with position and identifier", () => {
    const { issues, valid } = validateComponent(
      { identifier: "bad-id", kind: "connector", scope: "project", name: "", spec: [], requires: 1 },
      7,
    );
    assert.equal(valid, null);
    assert.deepEqual(
      issues.map((i) => i.field),
      ["identifier", "scope", "name", "spec", "requires"],
    );
    for (const i of issues) {
      assert.equal(i.index, 7);
      assert.equal(i.identifier, "bad-id");
    }
  });

  test("a non-string identifier is reported as null", () => {
    const { issues } = validateComponent({ identifier: 12 }, 0);
    assert.ok(issues.length > 0);
    for (const i of issues) assert.equal(i.identifier, null);
  });
});

describe("validateSet", () => {
  test("refuses anything that is not a non-empty array", () => {
    for (const [input, message] of [
      [undefined, "must be an array"],
      [{ components: [] }, "must be an array"],
      ["[]", "must be an array"],
      [[], "is empty"],
    ] as const) {
      assert.deepEqual(validateSet(input), {
        issues: [{ index: -1, identifier: null, field: "components", message }],
        valid: [],
      });
    }
  });

  test(`accepts exactly ${MAX_SET_COMPONENTS} components and refuses one more`, () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => connector({ identifier: `c${i}` }));
    const atLimit = validateSet(many(MAX_SET_COMPONENTS));
    assert.deepEqual(atLimit.issues, []);
    assert.equal(atLimit.valid.length, MAX_SET_COMPONENTS);

    const over = validateSet(many(MAX_SET_COMPONENTS + 1));
    assert.deepEqual(over.valid, []);
    assert.deepEqual(over.issues.map((i) => [i.index, i.field]), [[-1, "components"]]);
    assert.match(over.issues[0]!.message, new RegExp(`at most ${MAX_SET_COMPONENTS}`));
  });

  test("keeps the valid components and reports the rest by position", () => {
    const { issues, valid } = validateSet([
      connector({ identifier: "a" }),
      connector({ identifier: "b-bad" }),
      connector({ identifier: "c" }),
    ]);
    assert.deepEqual(valid.map((c) => c.identifier), ["a", "c"]);
    assert.deepEqual(issues.map((i) => [i.index, i.field]), [[1, "identifier"]]);
  });

  test("a second component with the same identifier is refused, pointing at the first", () => {
    const { issues, valid } = validateSet([
      connector({ identifier: "gcp" }),
      connector({ identifier: "other" }),
      connector({ identifier: "gcp", name: "Second GCP" }),
    ]);
    assert.deepEqual(valid.map((c) => c.name), ["GCP", "GCP"]);
    assert.deepEqual(valid.map((c) => c.identifier), ["gcp", "other"]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.index, 2);
    assert.equal(issues[0]!.identifier, "gcp");
    assert.match(issues[0]!.message, /duplicates the component at position 0/);
  });

  test("an invalid entry does not claim its identifier", () => {
    const { issues, valid } = validateSet([
      connector({ identifier: "gcp", name: "" }),
      connector({ identifier: "gcp" }),
    ]);
    assert.deepEqual(valid.map((c) => c.identifier), ["gcp"]);
    assert.deepEqual(issues.map((i) => [i.index, i.field]), [[0, "name"]]);
  });

  test("null and non-object entries are reported, not thrown on", () => {
    const { issues, valid } = validateSet([null, 5, "x", connector()]);
    assert.deepEqual(valid.map((c) => c.identifier), ["gcp"]);
    assert.deepEqual([...new Set(issues.map((i) => i.index))], [0, 1, 2]);
  });
});
