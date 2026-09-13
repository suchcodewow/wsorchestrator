/**
 * The scenario catalog exists twice, and this is what keeps the two copies
 * honest.
 *
 * A scenario is Terraform, so it ships in the runner's image; the checkboxes
 * that select it are rendered by the frontend, built from a different Docker
 * context that cannot see `terraform/`. Neither side can read the other at
 * build time, so `frontend/src/lib/scenario-catalog.ts` mirrors the
 * `scenario.json` manifests by hand.
 *
 * Nothing at runtime notices when those drift. The failure is quiet and
 * asymmetric: an entry in the frontend with no manifest is a checkbox that
 * fails the run when it is ticked, and a manifest with no frontend entry is a
 * scenario nobody can select. Both are the kind of thing that survives review
 * and surfaces during a challenge. So the mirror is checked here, in the suite
 * that already gates CI.
 *
 * Importing the frontend module directly is the same trick `identifier.test.ts`
 * uses — and the reason `scenario-catalog.ts` is deliberately import-free.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SCENARIOS } from "../../frontend/src/lib/scenario-catalog.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = path.join(HERE, "..", "terraform", "scenarios");

const CLOUDS = ["aws", "azure", "gcp"];

type Manifest = {
  id: string;
  label: string;
  cloud: string;
  description: string;
  requiresCluster?: boolean;
  activateApis?: string[];
};

/** Every scenario directory on disk, by directory name. */
function manifestsOnDisk(): Map<string, Manifest> {
  const found = new Map<string, Manifest>();
  for (const entry of fs.readdirSync(SCENARIOS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(SCENARIOS_DIR, entry.name, "scenario.json");
    assert.ok(
      fs.existsSync(file),
      `terraform/scenarios/${entry.name} has no scenario.json — either add one ` +
        `or move the directory out of scenarios/`,
    );
    found.set(entry.name, JSON.parse(fs.readFileSync(file, "utf8")) as Manifest);
  }
  return found;
}

describe("scenario manifests", () => {
  test("every manifest's id matches its directory", () => {
    // The id is the Terraform state prefix and the value stored on a run, so a
    // manifest whose id drifts from its directory silently orphans live state.
    for (const [dir, manifest] of manifestsOnDisk()) {
      assert.equal(
        manifest.id,
        dir,
        `terraform/scenarios/${dir}/scenario.json declares id ${JSON.stringify(manifest.id)}`,
      );
    }
  });

  test("every manifest names a real cloud and has a label", () => {
    for (const [dir, m] of manifestsOnDisk()) {
      assert.ok(CLOUDS.includes(m.cloud), `${dir}: cloud ${m.cloud} is not a cloud`);
      assert.ok(
        typeof m.label === "string" && m.label.length > 0,
        `${dir}: needs a label — it is what the checkbox says`,
      );
      assert.ok(
        typeof m.description === "string" && m.description.length > 0,
        `${dir}: needs a description — it is what the checkbox says underneath`,
      );
    }
  });

  test("every scenario has the Terraform a root config needs", () => {
    // A manifest with no root is a checkbox that fails the apply when ticked.
    for (const dir of manifestsOnDisk().keys()) {
      for (const file of ["main.tf", "variables.tf", "backend.tf"]) {
        assert.ok(
          fs.existsSync(path.join(SCENARIOS_DIR, dir, file)),
          `terraform/scenarios/${dir} is missing ${file}`,
        );
      }
    }
  });

  test("a scenario that needs a cluster enables the API that builds one", () => {
    // GKE cannot be created in a project without container.googleapis.com, and
    // the projects layer only enables what the selected scenarios ask for.
    for (const [dir, m] of manifestsOnDisk()) {
      if (m.cloud !== "gcp" || !m.requiresCluster) continue;
      assert.ok(
        (m.activateApis ?? []).includes("container.googleapis.com"),
        `${dir}: requiresCluster is true, so activateApis must include container.googleapis.com`,
      );
    }
  });
});

describe("the frontend catalog mirrors the manifests", () => {
  test("the two describe the same set of scenarios", () => {
    const onDisk = [...manifestsOnDisk().keys()].sort();
    const inApp = SCENARIOS.map((s) => s.id).sort();

    assert.deepEqual(
      inApp,
      onDisk,
      `SCENARIOS in frontend/src/lib/scenario-catalog.ts does not match the ` +
        `manifests in runner/terraform/scenarios/. An entry with no manifest is ` +
        `a checkbox that fails the run; a manifest with no entry cannot be ` +
        `selected at all.`,
    );
  });

  test("label, cloud and description agree entry for entry", () => {
    const manifests = manifestsOnDisk();
    for (const entry of SCENARIOS) {
      const m = manifests.get(entry.id);
      assert.ok(m, `${entry.id}: no manifest`);
      assert.equal(entry.label, m.label, `${entry.id}: label differs`);
      assert.equal(entry.cloud, m.cloud, `${entry.id}: cloud differs`);
      assert.equal(
        entry.description,
        m.description,
        `${entry.id}: description differs — the manifest is the source of truth`,
      );
    }
  });

  test("ids are unique", () => {
    const ids = SCENARIOS.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate scenario id");
  });
});
