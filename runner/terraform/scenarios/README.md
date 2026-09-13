# Scenarios — optional Terraform layered onto a challenge

A **scenario** is a bundle of Terraform an organizer turns on with a checkbox
when booking a challenge, and can turn on or off again afterwards from the run
page. Each one is its own root config with its own state, so adding a scenario
never touches the challenge roots and turning one off never disturbs another.

Two ship today, both ported from the `workshop` repo's `addons/` layer:

| Scenario | What the competitor runs into |
| --- | --- |
| `gcp-connectivity-egress` | Nodes have no route to the internet. Pods sit in `ImagePullBackOff` against public registries; a Harness delegate installs but never registers. |
| `gcp-connectivity-binauthz` | Only images from the competitor's own registries are admitted. Anything else is denied at pod admission and never pulled. |

## What a challenge looks like with scenarios on

Four layers, applied in order, each on its own state prefix under the run's:

```
<state_prefix>                   challenges/gcp-per-user       one project per competitor
<state_prefix>/cluster           challenges/gcp-per-user-gke   one cluster per competitor
<state_prefix>/scenarios/<id>    scenarios/<id>                the issues
```

Teardown runs in reverse. That order is not cosmetic: deleting a GCP project
takes everything inside it with it, so the layers above have to go first or
their state is left describing resources that no longer exist.

The cluster layer is built only when a selected scenario asks for one, and it
is **not** destroyed when scenarios are switched off — unchecking an issue must
not delete the environment a competitor is working in. It goes when the run does.

Every layer `for_each`es over the competitor→project map, so one apply covers
all competitors concurrently.

## Writing one

Copy an existing directory. A scenario is:

```
scenarios/<your-id>/
  scenario.json    the manifest — see below
  main.tf          your resources, for_each over var.attendee_projects
  variables.tf     copy verbatim; every scenario takes the same inputs
  outputs.tf       optional, namespaced by scenario id
  versions.tf      copy verbatim
  backend.tf       copy verbatim
```

`scenario.json` is the source of truth for everything outside the Terraform:

```json
{
  "id": "gcp-connectivity-egress",
  "label": "Connectivity: Egress",
  "cloud": "gcp",
  "description": "One sentence, shown under the checkbox.",
  "requiresCluster": true,
  "activateApis": ["container.googleapis.com"]
}
```

- **`id`** must equal the directory name. It is the state prefix and the value
  stored on the run, so renaming one orphans live state — pick it carefully.
- **`cloud`** decides which cloud's checkbox list it appears in. A challenge
  runs on exactly one cloud, so only that cloud's scenarios are offered.
- **`requiresCluster`** builds `challenges/gcp-per-user-gke` first and gives you
  `network_names` and `node_tags` to target.
- **`activateApis`** are enabled in every competitor's project before your layer
  applies. The union across selected scenarios is what the projects layer gets;
  a challenge with no scenarios enables only `compute.googleapis.com`, as before.

### The inputs you get

`variables.tf` is identical in every scenario and is written by one function in
the runner (`writeScenarioTfvars`). Declare all of them even if you use none —
an undeclared variable in the tfvars is a warning on every apply.

| Variable | |
| --- | --- |
| `attendee_projects` | address → project id. Your `for_each`. |
| `network_names` | address → the VPC their cluster is on. Empty without a cluster. |
| `node_tags` | address → the network tag on their nodes. **Scope to this**, or a rule written for one competitor reaches another's environment. |
| `region`, `labels`, `run_id`, `scenario_id` | |

### Two rules worth stating

**Be destroyable.** Unchecking the scenario runs `terraform destroy` on your
layer, and the competitor's environment has to come back to working order. Do
not modify anything the cluster or projects layer owns — take a dependency on it
instead. That is why `private_google_access` and Binary Authorization
enforcement are set by the cluster layer, where they are inert, rather than by
the scenarios that rely on them.

**Do not open a path to Harness.** Installing a delegate is the win condition
for the connectivity scenarios; a scenario that allowlists Harness traffic hands
the competitor the answer.

## Registering it

The frontend cannot read this directory — the two images are built from
different contexts (`runner/Dockerfile` copies `terraform/`, `frontend/Dockerfile`
copies only `frontend/`), so the catalog is mirrored rather than shared. Add
your entry to `SCENARIOS` in `frontend/src/db/schema.ts` to match your manifest.

`runner/test/scenario-catalog.test.ts` fails if the two disagree, so
`cd runner && npm run verify` will tell you if you missed it.

## Checking your work before it reaches a cloud

```sh
cd runner/terraform/scenarios/<your-id>
tofu init -backend=false && tofu validate
```

`TESTING.md` covers the rest of exercising the runner without deploying.
