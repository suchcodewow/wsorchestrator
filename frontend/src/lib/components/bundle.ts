import "server-only";
import { zip, type ZipEntry } from "@/lib/zip";
import { listBaseline, type CatalogComponent } from "./catalog";
import { MAX_SET_COMPONENTS } from "./validate";

/**
 * The contributor bundle: a Claude Code skill, generated from the live catalog.
 *
 * Generated per request rather than checked in, because the most useful thing
 * in it is the list of components that already exist — which is exactly the
 * part a static file gets wrong first. A contributor who unzips this is looking
 * at what the baseline holds right now, so Claude references the connector that
 * is actually there rather than inventing a plausible identifier.
 *
 * It carries no Harness credential. The scripts talk to the portal; the portal
 * talks to Harness with its own key. That is what makes handing this to people
 * outside the team reasonable at all, and it is why the sandbox run is started
 * through an API here rather than by anything the contributor runs locally.
 */

/** Where the skill unpacks to, and what Claude Code will call it. */
const SKILL_DIR = "harness-components";

function skillMd(components: CatalogComponent[]): string {
  const byKind = (kind: string) =>
    components.filter((c) => c.kind === kind).map((c) => c.identifier);

  return `---
name: harness-components
description: Write, test, and submit Harness components (secrets, connectors, templates) for workshop environments. Use when adding or changing anything the workshop orchestrator deploys into a Harness org.
---

# Harness components

Workshop environments are built from a catalog of Harness entities: secrets,
connectors, and templates. This skill is for adding to that catalog and getting
the addition reviewed.

## What already exists

Read \`catalog/\` before writing anything. It is the published baseline as of
when this bundle was downloaded — every component below is already deployed
into every workshop, and new work should reference these rather than duplicate
them.

- **secrets**: ${byKind("secret_text").concat(byKind("secret_file")).join(", ") || "(none)"}
- **connectors**: ${byKind("connector").join(", ") || "(none)"}
- **templates**: ${byKind("template").join(", ") || "(none)"}

## How components refer to each other

One component names another as \`org.<identifier>\` — a connector's
\`secretKeyRef: org.gcp_service_account\`, a template's
\`templateRef: org.deploy_base\`, a pipeline's \`connectorRef: org.gcp\`.

**Dependencies are inferred from those references.** You do not need to declare
\`dependsOn\`; writing the reference is declaring it. The runner sorts the whole
catalog topologically and creates each component after everything it names.
Declare \`dependsOn\` only for an ordering the spec does not already imply.

A reference to something outside the catalog is fine and is ignored —
\`org.harnessSecretManager\` is a Harness built-in, not a component here.

## Writing a component

Put one JSON file per component in \`candidate/\`. The shape:

\`\`\`json
{
  "identifier": "deploy_to_gke",
  "kind": "template",
  "scope": "org",
  "name": "Deploy To GKE",
  "description": "Deploys a container to the workshop cluster.",
  "spec": { "yaml": "template:\\n  type: Stage\\n  spec: ..." },
  "requires": [],
  "versionLabel": "1"
}
\`\`\`

\`kind\` is one of \`secret_text\`, \`secret_file\`, \`connector\`, \`template\`.
\`scope\` must be \`org\` — per-attendee components are not supported yet.

### spec, by kind

| kind | spec field | holds |
|---|---|---|
| \`secret_text\` | \`value\` | the secret's value, usually a binding |
| \`secret_file\` | \`content\` | the file's contents, usually a binding |
| \`connector\` | \`type\` + \`spec\` | Harness connector type and its payload |
| \`template\` | \`yaml\` | template YAML, starting with \`template:\` |

### Bindings

A spec may contain \`\${...}\` for the parts only a running workshop knows:

- \`\${org.id}\` — the workshop's Harness organization identifier
- \`\${run.name}\`, \`\${run.slug}\`, \`\${run.id}\`
- \`\${outputs.<name>}\` — any Terraform output, including cloud credentials

A string that is *only* a binding keeps the value's type; anything else
interpolates as text.

List in \`requires\` every binding the component cannot be created without. A
component whose requirements are unmet is skipped when nothing it depends on
was built, and is an **error** when everything it depends on *was* built. That
is what distinguishes "this workshop has no AWS" from "the AWS credential
arrived broken".

### Templates

Write only what the template *does*. \`name\`, \`identifier\`, \`versionLabel\`,
\`orgIdentifier\`, and \`projectIdentifier\` are filled in by the runner — if you
include them they are stripped and replaced, so leave them out.

A template's identity is its identifier *and* its version label. To change a
published template, raise \`versionLabel\` rather than editing in place: a
workshop mid-lab keeps resolving the version its pipelines were written
against.

### Identifiers

Start with a letter or underscore, then letters, digits, underscores, or
dollars, up to 128 characters. **No hyphens** — except in secrets, which allow
them. These are reserved by the Harness expression language and will be
rejected: \`or and eq ne lt gt le ge div mod not null true false new var return
step parallel stepgroup org account status liteenginetask notification\`.

## Testing

Two commands, in this order:

\`\`\`sh
node scripts/validate.mjs      # seconds; no Harness call, nothing created
node scripts/sandbox.mjs "Add GKE deploy template"
\`\`\`

The scripts authenticate with the \`.env\` this bundle was downloaded with —
there is nothing to set up. If they report a missing token, the bundle has been
superseded by a newer download; get a fresh one from the Contribute page.

\`validate\` checks each component on its own — identifiers, kinds, spec shape.
It does **not** check dependency cycles or references to components that do not
exist; those need the whole catalog and are checked when the sandbox run
starts. A clean validate is not a clean result overall.

\`sandbox\` creates the candidate set and starts a Harness-only run: a real
organization with the baseline plus your components, and a project for you to
build in. No cloud is provisioned, so it is fast and costs nothing. It prints a
run URL — watch it there.

A component needing a cloud credential will be reported as **not exercised**.
That is expected and honest: a Harness-only run has no GCP key, so a connector
depending on one is created but never authenticates. Say so when you submit,
and a reviewer can run the full thing.

**Then actually use it.** A template that was created successfully has not been
tested. Open the project the run gives you, build a pipeline from your
template, and run it.

Iterating: \`node scripts/sandbox.mjs --update <setId>\` replaces the set's
components and starts a fresh run.

## Submitting

\`\`\`sh
node scripts/submit.mjs <setId> "what this adds and what you tested"
\`\`\`

There is no upload. Your components have been in the portal since the sandbox
run, so submitting changes their status — what a reviewer reads is exactly what
you tested. A manager reviews and either publishes them into the baseline or
sends them back with notes.

## Limits

At most ${MAX_SET_COMPONENTS} components in one set.
`;
}

function readmeMd(expiresAt: Date): string {
  return `# Harness components — contributor bundle

Unzip into a project so Claude Code finds the skill:

    .claude/skills/${SKILL_DIR}/

That is the whole setup. Then tell Claude what you want to add — it reads
\`catalog/\` for what already exists, writes into \`candidate/\`, and runs the
scripts to validate and test.

## About the token

This bundle contains its own credential, in \`.env\`. Nothing to create, nothing
to export.

- It expires on **${expiresAt.toISOString().slice(0, 10)}**.
- Downloading the bundle again issues a new one and **revokes this one**, so the
  copy you are reading now will stop working. Use the most recent download.
- It reaches the component endpoints and nothing else: it cannot schedule
  events, read attendee details, or change site settings.
- You never need a Harness API key. The scripts talk to the portal; the portal
  talks to Harness.

Treat \`.env\` as a secret — a \`.gitignore\` beside it keeps it out of commits,
but it is still a live credential sitting in a file. If it leaks, revoke it on
the Contribute page.

To point the scripts at a different portal, set \`WORKSHOP_PORTAL_URL\` in the
environment; a real environment variable overrides the file.
`;
}

/** One catalog component as a file a contributor reads and copies from. */
function componentFile(c: CatalogComponent): ZipEntry {
  return {
    path: `${SKILL_DIR}/catalog/${c.identifier}.json`,
    content: `${JSON.stringify(
      {
        identifier: c.identifier,
        kind: c.kind,
        scope: c.scope,
        name: c.name,
        description: c.description,
        spec: c.spec,
        requires: c.requires,
        dependsOn: c.dependsOn,
        versionLabel: c.versionLabel,
        // Not part of the shape a contributor submits; included because it
        // answers "may I change this one?" without a trip to the portal.
        builtin: c.builtin,
      },
      null,
      2,
    )}\n`,
  };
}

/** Shared preamble for the scripts: config, fetch, and error reporting. */
const SCRIPT_LIB = `import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Config comes from the .env this bundle was downloaded with, so nothing has to
 * be exported before the scripts run. A real environment variable still wins,
 * which is what makes pointing at a different portal a one-liner rather than a
 * file edit.
 *
 * Parsed by hand rather than with a dependency: the file is two lines this
 * bundle wrote itself, and \`node --env-file\` is not on every version anyone
 * might be running.
 */
function loadEnv() {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  const values = {};
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return values;
  }
  for (const line of text.split("\\n")) {
    const match = /^\\s*([A-Z_][A-Z0-9_]*)\\s*=\\s*(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return values;
}

const env = loadEnv();
const BASE = (process.env.WORKSHOP_PORTAL_URL ?? env.WORKSHOP_PORTAL_URL ?? "").replace(
  /\\/+$/,
  "",
);
const TOKEN = process.env.WORKSHOP_API_TOKEN ?? env.WORKSHOP_API_TOKEN ?? "";

if (!BASE || !TOKEN) {
  console.error(
    "No portal URL or token. These normally come from the .env in this bundle —\\n" +
      "if it is missing, download the bundle again from the Contribute page.",
  );
  process.exit(2);
}

/** Every .json file in candidate/, in a stable order. */
export function loadCandidates(dir = "candidate") {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    console.error(\`No \${dir}/ directory — put one JSON file per component there.\`);
    process.exit(2);
  }
  if (files.length === 0) {
    console.error(\`\${dir}/ is empty — nothing to do.\`);
    process.exit(2);
  }
  return files.map((f) => {
    const path = join(dir, f);
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      console.error(\`\${path} is not valid JSON: \${err.message}\`);
      process.exit(1);
    }
  });
}

export { BASE };

export async function api(path, init = {}) {
  let res;
  try {
    res = await fetch(\`\${BASE}\${path}\`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: \`Bearer \${TOKEN}\`,
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    // Unreachable portal: wrong URL, no network, VPN off. A stack trace helps
    // nobody here — the cause is almost always outside this machine.
    console.error(\`Could not reach \${BASE} — \${err.message}\`);
    console.error("Check you are on the network the portal is behind.");
    process.exit(1);
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    console.error(\`\${res.status} from \${path}: \${text.slice(0, 400)}\`);
    process.exit(1);
  }
  return { status: res.status, body };
}

/** Print validation issues the way a person reads them: grouped by component. */
export function printIssues(issues) {
  const byComponent = new Map();
  for (const issue of issues) {
    const key = issue.identifier ?? \`(component \${issue.index})\`;
    if (!byComponent.has(key)) byComponent.set(key, []);
    byComponent.get(key).push(issue);
  }
  for (const [name, list] of byComponent) {
    console.error(\`\\n  \${name}\`);
    for (const i of list) console.error(\`    \${i.field}: \${i.message}\`);
  }
}
`;

const VALIDATE_SCRIPT = `#!/usr/bin/env node
// Check every component in candidate/ without creating anything.
//
// Per-component checks only: identifiers, kinds, scopes, spec shape. Cycles and
// references to components that do not exist need the whole catalog and are
// checked when a sandbox run starts.
import { loadCandidates, api, printIssues } from "./lib.mjs";

const components = loadCandidates();
const { status, body } = await api("/api/components/validate", {
  method: "POST",
  body: JSON.stringify({ components }),
});

if (status !== 200) {
  console.error(\`Validation request failed (\${status}): \${body.error ?? ""}\`);
  process.exit(1);
}

if (body.ok) {
  console.log(\`\${body.accepted} component(s) look right.\`);
  console.log(body.note);
  process.exit(0);
}

console.error(\`\${body.issues.length} problem(s) in \${components.length} component(s):\`);
printIssues(body.issues);
process.exit(1);
`;

const SANDBOX_SCRIPT = `#!/usr/bin/env node
// Create a candidate set from candidate/ and start the run that tests it.
//
//   node scripts/sandbox.mjs "Add GKE deploy template"
//   node scripts/sandbox.mjs --update <setId>
import { loadCandidates, api, printIssues, BASE } from "./lib.mjs";

const args = process.argv.slice(2);
const update = args[0] === "--update" ? args[1] : null;
const name = update ? null : args.join(" ").trim();

if (!update && !name) {
  console.error('Usage: sandbox.mjs "what this adds"  |  sandbox.mjs --update <setId>');
  process.exit(2);
}

const components = loadCandidates();

if (update) {
  const replaced = await api(\`/api/component-sets/\${update}\`, {
    method: "PUT",
    body: JSON.stringify({ components }),
  });
  if (replaced.status !== 200) {
    if (replaced.body.issues) printIssues(replaced.body.issues);
    else console.error(replaced.body.message ?? replaced.body.error);
    process.exit(1);
  }
  console.log(\`Updated set \${update} to \${replaced.body.components} component(s).\`);
}

const { status, body } = await api("/api/component-sets", {
  method: "POST",
  body: JSON.stringify({ name: name ?? \`Re-test \${update}\`, components }),
});

if (status !== 201) {
  if (body.issues) {
    console.error("Components did not pass validation:");
    printIssues(body.issues);
  } else {
    console.error(\`Could not start a sandbox run (\${status}): \${body.error ?? ""}\`);
  }
  process.exit(1);
}

console.log(\`Set:  \${body.setId}\`);
if (body.run) {
  console.log(\`Run:  \${BASE}/runs/\${body.run.id}\`);
  console.log(
    body.started
      ? "\\nStarted. Watch the run page — it lists each component as it lands, and\\n" +
        "names any that could not be exercised without a cloud credential.\\n\\n" +
        "When it is ready: open the Harness project it gives you, build a pipeline\\n" +
        "from your components, and run it. A component that was merely created has\\n" +
        "not been tested."
      : "\\nQueued — the scheduler will pick it up shortly.",
  );
}
`;

const SUBMIT_SCRIPT = `#!/usr/bin/env node
// Offer a tested set for review.
//
//   node scripts/submit.mjs <setId> "what this adds and what you tested"
//
// Nothing is uploaded: the components have been in the portal since the sandbox
// run, so this changes their status. What the reviewer reads is what you tested.
import { api } from "./lib.mjs";

const [setId, ...rest] = process.argv.slice(2);
const notes = rest.join(" ").trim();

if (!setId) {
  console.error('Usage: submit.mjs <setId> "what this adds and what you tested"');
  process.exit(2);
}

const { status, body } = await api(\`/api/component-sets/\${setId}/submit\`, {
  method: "POST",
  body: JSON.stringify({ notes }),
});

if (status !== 200) {
  console.error(\`Could not submit (\${status}): \${body.message ?? body.error ?? ""}\`);
  process.exit(1);
}

console.log(\`Submitted. \${body.testedBy.length} sandbox run(s) exercised this set.\`);
if (body.untested) {
  console.log(
    "Note: no sandbox run has ever deployed these components. That is allowed,\\n" +
      "but the reviewer will see it — testing first makes a review much faster.",
  );
}
`;

const BINDINGS_REFERENCE = `# Bindings

The values a component's spec can reference as \`\${...}\`.

| binding | is |
|---|---|
| \`org.id\` | the workshop's Harness organization identifier |
| \`run.id\` | the run's UUID |
| \`run.name\` | the event's name as the organizer typed it |
| \`run.slug\` | that name slugified, as used in cloud resource names |
| \`outputs.<name>\` | any Terraform output from any cloud applied so far |

## Resolution

A string that is *only* a binding takes the value's own type:

    "spec": { "count": "\${outputs.node_count}" }     -> a number

Anything else interpolates as text:

    "projects/\${outputs.gcp_project_id}/locations"   -> a string

An empty string counts as **absent**, not as a value. Terraform renders a
disabled optional output as \`""\`, which is exactly how a switched-off cloud's
credential arrives, and a secret created from an empty string is worse than one
not created at all.

## Credentials

These arrive only on a run that provisioned the cloud in question. They are
never stored in the run's outputs — they exist for the duration of the apply
and are handed to the catalog directly.

| output | is |
|---|---|
| \`outputs.harness_gcp_key_json\` | GCP service account key (a file secret) |
| \`outputs.harness_azure_client_secret\` | Azure app registration client secret |
| \`outputs.harness_azure_client_id\` | Azure application id |
| \`outputs.harness_azure_tenant_id\` | Azure tenant id |
| \`outputs.harness_aws_access_key_id\` | AWS access key id |
| \`outputs.harness_aws_secret_access_key\` | AWS secret access key |

A Harness-only sandbox run has none of these, so anything listing one in
\`requires\` is reported as not exercised. That is the expected result, not a
failure.

## requires

List every binding the component cannot be created without.

- dependencies unmet or absent, own requirements unmet → **skipped**, quietly
- every dependency applied, own requirements unmet → **error**, loudly

Which is how "this workshop has no AWS" stays quiet while "the AWS credential
arrived without its access key id" fails the run.
`;

/**
 * Build the bundle for the current baseline.
 *
 * Returns the archive and a filename carrying the component count, so a
 * contributor with two downloads can tell which is which.
 */
export async function buildBundle(credential: {
  portalUrl: string;
  token: string;
  expiresAt: Date;
}): Promise<{ filename: string; archive: Buffer }> {
  const components = await listBaseline();

  const entries: ZipEntry[] = [
    { path: `${SKILL_DIR}/SKILL.md`, content: skillMd(components) },
    { path: `${SKILL_DIR}/README.md`, content: readmeMd(credential.expiresAt) },
    // The credential, and the one file in here that must not be committed.
    // Written as .env rather than baked into lib.mjs because that is the file
    // people already expect to hold a secret and already expect to ignore.
    {
      path: `${SKILL_DIR}/.env`,
      content:
        `# Written when this bundle was downloaded. Do not commit.\n` +
        `# Expires ${credential.expiresAt.toISOString().slice(0, 10)}; ` +
        `downloading again replaces it.\n` +
        `WORKSHOP_PORTAL_URL="${credential.portalUrl}"\n` +
        `WORKSHOP_API_TOKEN="${credential.token}"\n`,
    },
    {
      path: `${SKILL_DIR}/.gitignore`,
      content: `# A live credential, written at download time.\n.env\n`,
    },
    {
      path: `${SKILL_DIR}/reference/bindings.md`,
      content: BINDINGS_REFERENCE,
    },
    { path: `${SKILL_DIR}/scripts/lib.mjs`, content: SCRIPT_LIB },
    { path: `${SKILL_DIR}/scripts/validate.mjs`, content: VALIDATE_SCRIPT },
    { path: `${SKILL_DIR}/scripts/sandbox.mjs`, content: SANDBOX_SCRIPT },
    { path: `${SKILL_DIR}/scripts/submit.mjs`, content: SUBMIT_SCRIPT },
    ...components.map(componentFile),
    // An empty directory cannot be expressed in a ZIP, and the scripts fail
    // with a readable message when `candidate/` is missing — but a contributor
    // should find the place their work goes already there, with the shape in it.
    {
      path: `${SKILL_DIR}/candidate/EXAMPLE.json.txt`,
      content: `${JSON.stringify(
        {
          identifier: "example_connector",
          kind: "connector",
          scope: "org",
          name: "Example",
          description: "Delete this file. It is here to show the shape.",
          spec: {
            type: "Gcp",
            spec: {
              credential: {
                type: "ManualConfig",
                spec: { secretKeyRef: "org.gcp_service_account" },
              },
            },
          },
          requires: [],
        },
        null,
        2,
      )}\n`,
    },
  ];

  return {
    filename: `harness-components-${components.length}.zip`,
    archive: zip(entries),
  };
}
