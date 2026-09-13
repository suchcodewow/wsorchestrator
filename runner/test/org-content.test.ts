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

import {
  isPolicyDuplicate,
  missingSecret,
  policyIsInScope,
  rescopeYaml,
} from "../src/org-content.js";

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

/**
 * The policy API refuses a repeated create in wording no other Harness API
 * uses, and both strings below came off the live account. `isDuplicate` matches
 * neither, so without this the second copy pass — the one `run.ts` makes once
 * the clouds are up — would mark every policy that is already there `failed`.
 */
describe("isPolicyDuplicate", () => {
  const refusal = (message: string) =>
    JSON.stringify({ name: "BadRequest", id: "4w215m-9", message });

  test("reads the policy API's 400 as a duplicate", () => {
    assert.equal(
      isPolicyDuplicate(400, refusal("policy identifier must be unique")),
      true,
    );
  });

  test("reads the policy set API's 400 as a duplicate", () => {
    assert.equal(
      isPolicyDuplicate(400, refusal("policy set identifier must be unique")),
      true,
    );
  });

  test("still reads the platform APIs' own wording", () => {
    assert.equal(
      isPolicyDuplicate(
        400,
        JSON.stringify({ code: "DUPLICATE_FIELD", message: "A filter already exists" }),
      ),
      true,
    );
    assert.equal(isPolicyDuplicate(409, "{}"), true);
  });

  test("leaves a real 400 alone", () => {
    assert.equal(
      isPolicyDuplicate(400, refusal("rego compilation failed: undefined function")),
      false,
    );
  });
});

/**
 * Which policies a copied policy set may still point at.
 *
 * The trap this guards is that Harness accepts `account.foo` on a write and
 * reads it back as a bare `foo` with an empty `org_id` — so the scope has to
 * come from those fields, never from how the reference was spelled. Getting it
 * wrong produces an org-level reference to a policy that is not in the org,
 * which resolves to nothing and reports no error.
 */
describe("policyIsInScope", () => {
  const orgSource = { token: "t", accountId: "a", org: "authoring", project: null };
  const projectSource = { ...orgSource, project: "content" };

  test("keeps a policy from the org the source names", () => {
    assert.equal(
      policyIsInScope({ org_id: "authoring", project_id: "" }, orgSource),
      true,
    );
  });

  test("drops an account-level policy, which reads back looking org-level", () => {
    assert.equal(policyIsInScope({ org_id: "", project_id: "" }, orgSource), false);
    // The same object with the fields absent entirely, which is how the API
    // renders an account-level policy on some responses.
    assert.equal(policyIsInScope({}, orgSource), false);
  });

  test("drops a policy from a different org", () => {
    assert.equal(
      policyIsInScope({ org_id: "elsewhere", project_id: "" }, orgSource),
      false,
    );
  });

  test("separates an org source from a project one", () => {
    const inProject = { org_id: "authoring", project_id: "content" };
    // A project-scoped source copies its project's policies...
    assert.equal(policyIsInScope(inProject, projectSource), true);
    // ...and an org-scoped source does not reach into that project.
    assert.equal(policyIsInScope(inProject, orgSource), false);
  });
});
