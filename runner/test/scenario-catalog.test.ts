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
  perCompetitor?: boolean;
  providesCluster?: boolean;
};

/** The variables declared by a scenario root, by name. */
function declaredVars(dir: string): Set<string> {
  const file = path.join(SCENARIOS_DIR, dir, "variables.tf");
  return new Set(
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .flatMap((l) => {
        const m = l.match(/^variable "([^"]+)"/);
        return m ? [m[1]] : [];
      }),
  );
}

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
    // A manifest with no root is a checkbox that fails the apply when ticked —
    // unless it is a cluster scenario, which deliberately has none.
    for (const [dir, m] of manifestsOnDisk()) {
      if (m.providesCluster) continue;
      for (const file of ["main.tf", "variables.tf", "backend.tf"]) {
        assert.ok(
          fs.existsSync(path.join(SCENARIOS_DIR, dir, file)),
          `terraform/scenarios/${dir} is missing ${file}`,
        );
      }
    }
  });

  test("a cluster scenario has no Terraform of its own", () => {
    // The cluster layer builds the cluster. A stray .tf here would be applied
    // against a state prefix nothing else knows about, and destroyed by
    // nothing — the runner skips the apply step for these entirely.
    for (const [dir, m] of manifestsOnDisk()) {
      if (!m.providesCluster) continue;
      const stray = fs
        .readdirSync(path.join(SCENARIOS_DIR, dir))
        .filter((f) => f.endsWith(".tf"));
      assert.deepEqual(
        stray,
        [],
        `${dir} provides the cluster, so it must have no .tf files — the runner never applies it`,
      );
    }
  });

  test("every cloud that breaks a cluster can also build one", () => {
    // Otherwise the dependency has nothing to resolve to: the checkbox would
    // tick something that does not exist, and the cluster would never be built.
    const manifests = [...manifestsOnDisk().values()];
    const breaks = new Set(
      manifests.filter((m) => m.requiresCluster).map((m) => m.cloud),
    );
    const builds = new Set(
      manifests.filter((m) => m.providesCluster).map((m) => m.cloud),
    );
    for (const cloud of breaks) {
      assert.ok(
        builds.has(cloud),
        `${cloud} has a scenario needing a cluster but none providing one`,
      );
    }
  });

  test("a scenario does not both provide and require a cluster", () => {
    for (const [dir, m] of manifestsOnDisk()) {
      assert.ok(
        !(m.providesCluster && m.requiresCluster),
        `${dir}: providesCluster and requiresCluster are mutually exclusive`,
      );
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

  test("each root's variables match the shape its manifest declares", () => {
    // The two shapes take different tfvars, written by different functions. A
    // root whose variables disagree with its manifest gets tfvars full of
    // undeclared names and nothing it actually needs — an apply that fails, or
    // worse, silently does nothing because every `for_each` is empty.
    for (const [dir, m] of manifestsOnDisk()) {
      // A cluster scenario has no root, so it has no variables to check.
      if (m.providesCluster) continue;

      const vars = declaredVars(dir);

      if (m.perCompetitor) {
        assert.ok(
          vars.has("attendee_email"),
          `${dir}: perCompetitor, so it must declare attendee_email`,
        );
        for (const plural of [
          "attendee_projects",
          "attendee_resource_groups",
          "node_tags",
          "network_names",
        ]) {
          assert.ok(
            !vars.has(plural),
            `${dir}: perCompetitor roots get one competitor, so ${plural} would never be filled in`,
          );
        }
        continue;
      }

      assert.ok(
        vars.has("attendee_projects") || vars.has("attendee_resource_groups"),
        `${dir}: a roster scenario must declare the map it for_eaches over`,
      );
      assert.ok(
        !vars.has("attendee_email"),
        `${dir}: attendee_email is only filled in for perCompetitor roots`,
      );
    }
  });

  test("every AWS scenario is perCompetitor", () => {
    // Not a style rule: each competitor owns a separate member account, so
    // reaching into one needs an assumed-role provider, and Terraform cannot
    // build a dynamic number of those in a single configuration. A roster-shaped
    // AWS scenario cannot work.
    for (const [dir, m] of manifestsOnDisk()) {
      if (m.cloud !== "aws" || m.providesCluster) continue;
      assert.ok(
        m.perCompetitor,
        `${dir}: an AWS scenario needs perCompetitor — one assumed-role provider per account`,
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

  test("the cluster dependency agrees on both sides", () => {
    // The frontend decides from these two flags which checkbox to tick and
    // which to lock; the runner decides from them whether to build a cluster
    // and whether there is a layer to apply. Disagreeing means the box says one
    // thing and the provisioning does another — a challenge that looks right
    // and comes up wrong.
    const manifests = manifestsOnDisk();
    for (const entry of SCENARIOS) {
      const m = manifests.get(entry.id);
      assert.ok(m, `${entry.id}: no manifest`);
      assert.equal(
        "providesCluster" in entry,
        m.providesCluster === true,
        `${entry.id}: providesCluster differs from the manifest`,
      );
      assert.equal(
        "requiresCluster" in entry,
        m.requiresCluster === true,
        `${entry.id}: requiresCluster differs from the manifest`,
      );
    }
  });

  test("ids are unique", () => {
    const ids = SCENARIOS.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate scenario id");
  });
});
