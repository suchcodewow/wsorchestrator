/**
 * Readdressing an entity to the workshop's organization, and reading the one
 * sentence Harness says when the content needs a secret that is not there.
 *
 * Both are text handling against a system we cannot ask twice. `rescopeYaml`
 * rewrites a body full of `<+expressions>` and block scalars without parsing it,
 * so what it must not do — touch anything below the keys it owns — is as much
 * the point as what it must. `missingSecret` reads the message that decides
 * whether an entity gets a placeholder or waits for the real credential; a
 * regex that stops matching would silently turn every such entity into a plain
 * failure, which is the kind of break nothing else notices.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { missingSecret, rescopeYaml } from "../src/org-content.js";

describe("rescopeYaml", () => {
  test("replaces the keys that say where the entity lives", () => {
    const yaml = [
      "template:",
      "  name: build",
      "  identifier: build",
      "  versionLabel: v1",
      "  orgIdentifier: authoring",
      "  projectIdentifier: content",
      "  type: Stage",
    ].join("\n");

    const out = rescopeYaml(yaml, "template", {
      name: "build",
      identifier: "build",
      versionLabel: "v1",
      orgIdentifier: "workshop_abc",
      projectIdentifier: null,
    });

    assert.match(out, /^ {2}orgIdentifier: "workshop_abc"$/m);
    // The source's project is dropped rather than carried over: a null key is
    // not written, and the original line is still removed.
    assert.doesNotMatch(out, /projectIdentifier/);
    assert.match(out, /^ {2}type: Stage$/m);
  });

  test("leaves the body alone, expressions and all", () => {
    const yaml = [
      "template:",
      "  name: run",
      "  orgIdentifier: authoring",
      "  spec:",
      "    type: ShellScript",
      "    spec:",
      "      source:",
      "        spec:",
      "          script: |",
      "            echo <+pipeline.variables.orgIdentifier>",
      '            echo "identifier: not-a-key"',
    ].join("\n");

    const out = rescopeYaml(yaml, "template", {
      name: "run",
      orgIdentifier: "workshop_abc",
    });

    // A deeper `identifier:`/`orgIdentifier:` is somebody's script or a nested
    // field, not this entity's scope — only the two-space indent is ours.
    assert.match(out, /echo <\+pipeline\.variables\.orgIdentifier>/);
    assert.match(out, /echo "identifier: not-a-key"/);
    assert.equal(out.match(/^ {2}orgIdentifier:/gm)?.length, 1);
  });

  /*
   * A production "Deploy content" died on every template in a source with this
   * body shape:
   *
   *   Invalid request: Cannot create template entity due to while parsing a
   *   block mapping in 'reader', line 2, column 3: name: "IaCM Remediation
   *   Test" ^ expected <block end>, but found '<block mapping start>' in
   *   'reader', line 7, column 5 (HTTP 400)
   *
   * The indent was hardcoded at two spaces, so against a four-space body the
   * owned pattern matched nothing: the original keys stayed, ours were prepended
   * at two, and the document no longer parsed. Harness reported it as a YAML
   * error with no field named, which is why it was not obvious what had been
   * done to it.
   */
  test("takes the indent from the body instead of assuming two spaces", () => {
    const yaml = [
      "template:",
      "    name: IaCM Remediation Test",
      "    identifier: IaCM_Remediation_Test",
      "    versionLabel: v1",
      "    orgIdentifier: authoring",
      "    projectIdentifier: content",
      "    type: Stage",
      "    spec:",
      "        agent: iacm-agent",
    ].join("\n");

    const out = rescopeYaml(yaml, "template", {
      name: "IaCM Remediation Test",
      identifier: "IaCM_Remediation_Test",
      versionLabel: "v1",
      orgIdentifier: "workshop_abc",
      projectIdentifier: "default_project",
    });

    // Ours are written at the body's own indent, and the originals are gone —
    // exactly one of each key, or the document is invalid.
    assert.equal(out.match(/^ {4}orgIdentifier:/gm)?.length, 1);
    assert.equal(out.match(/^ {4}name:/gm)?.length, 1);
    assert.equal(out.match(/^ {4}projectIdentifier:/gm)?.length, 1);
    assert.match(out, /^ {4}orgIdentifier: "workshop_abc"$/m);
    assert.doesNotMatch(out, /^ {2}\w/m);
    // The body below the owned keys is untouched.
    assert.match(out, /^ {4}spec:$/m);
    assert.match(out, /^ {8}agent: iacm-agent$/m);
  });

  test("refuses a root key with nothing under it", () => {
    assert.throws(
      () => rescopeYaml("template:\n", "template", { name: "x" }),
      /expected this template to have indented keys/,
    );
  });

  test("quotes the values it writes", () => {
    const out = rescopeYaml("environment:\n  name: old\n", "environment", {
      name: 'a "quoted" name',
      identifier: "env",
    });
    assert.match(out, /^ {2}name: "a \\"quoted\\" name"$/m);
  });

  test("refuses a body that is not the entity it was promised", () => {
    assert.throws(
      () => rescopeYaml("service:\n  name: x\n", "environment", { name: "x" }),
      /expected this environment to start with "environment:"/,
    );
  });
});

describe("missingSecret", () => {
  test("reads the identifier and the scope out of the refusal", () => {
    const body = JSON.stringify({
      status: "ERROR",
      message:
        "Invalid request: No secret exists with the id github_token in organization authoring",
    });

    assert.deepEqual(missingSecret(body), {
      identifier: "github_token",
      org: "authoring",
      project: null,
    });
  });

  test("is not fooled by a refusal about something else", () => {
    const body = JSON.stringify({
      status: "ERROR",
      message: "Connector with identifier github already exists",
    });
    assert.equal(missingSecret(body), null);
  });
});
