# Scenarios — optional Terraform layered onto a challenge

A **scenario** is a bundle of Terraform an organizer turns on with a checkbox
when booking a challenge, and can turn on or off again afterwards from the run
page. Each one is its own root config with its own state, so adding a scenario
never touches the challenge roots and turning one off never disturbs another.

Eight ship today, across all three clouds. Three of them just build a cluster:

| Scenario | Cloud | What the competitor runs into |
| --- | --- | --- |
| `gcp-cluster` / `aws-cluster` / `azure-cluster` | each | Nothing. A working cluster, per competitor, and no problem with it. |
| `gcp-connectivity-egress` | GCP | Nothing leaves the VPC. *Every* image pull fails — theirs included — and pods across the cluster sit in `ImagePullBackOff`. |
| `gcp-connectivity-binauthz` | GCP | Only images from their own registries are admitted. Anything else is denied at pod admission and never pulled. |
| `gcp-delegate-blocked-manager` | GCP | The cluster is healthy and images pull, but nothing reaches the internet. A delegate installs, starts, and logs connection failures to `app.harness.io` forever. |
| `aws-connectivity-egress` | AWS | Nodes reach AWS but not the internet. ECR works, Docker Hub does not. |
| `azure-connectivity-egress` | Azure | Nodes reach Azure but not the internet. Microsoft's registries work, Docker Hub does not. |

The two egress scenarios and `delegate-blocked-manager` are worth contrasting,
because the difference is the lesson. Blunt egress denial blocks the delegate's
*image*, which lives on Google Artifact Registry at `us-docker.pkg.dev` — so the
pod never starts and there is nothing to read. `delegate-blocked-manager` builds
the network a locked-down enterprise actually has, private DNS to the restricted
VIP included, so the cluster is genuinely healthy and the delegate genuinely
runs. Only then is the log worth reading.

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

## The cluster scenarios

`gcp-cluster`, `aws-cluster` and `azure-cluster` are manifests with **no
Terraform of their own** — no `main.tf`, no state, no apply. The cluster layer
above already builds the cluster; these exist so an organizer can ask for one
*on its own* rather than only as a side effect of picking a problem.

Two flags express the relationship, and they are mutually exclusive:

- **`providesCluster`** — selecting this turns the cluster layer on, and there
  is no layer to apply. The runner skips it (`hasScenarioRoot`), and the drift
  test asserts the directory really holds no `.tf` (a stray one would be applied
  against a prefix nothing else knows about, and destroyed by nothing).
- **`requiresCluster`** — this breaks a cluster, so selecting it pulls that
  cloud's `providesCluster` scenario in automatically and locks its checkbox
  while it stays on.

The pull-in happens in the UI on click *and* again server-side in
`withClusterScenario`, because a selection that breaks a cluster without
building one describes a challenge that cannot be provisioned, and the dialog is
not the only way to reach the API.

Adding a scenario to a cloud that has no cluster scenario would leave that
dependency unresolvable, so the drift test checks for it.

## The two shapes

A scenario is applied one of two ways, and `perCompetitor` in its manifest says
which:

| | `perCompetitor: false` | `perCompetitor: true` |
| --- | --- | --- |
| Applies | once, `for_each` over the roster | once per competitor |
| State prefix | `<run>/scenarios/<id>` | `<run>/scenarios/<id>/<slug>` |
| Variables | maps keyed by address | singular — one project, one cluster |
| Concurrency | Terraform's, inside one apply | the runner's, across applies |

Use the roster shape when you can. Use `perCompetitor` when you cannot, which is
whenever the scenario needs a provider that can only be configured once per
target:

- **anything on AWS** — each competitor owns a separate member account, so the
  `aws` provider has to assume a different role for each, and Terraform cannot
  build a dynamic number of those;
- **anything inside a cluster** — the `kubernetes` and `helm` providers have the
  same limitation. `terraform/delegates/gke/main.tf` is the template: data
  sources for one cluster, providers pointed at it.

Per-competitor applies get a private copy of the root under
`terraform/.work/<name>` — two directories deep, so your `../../modules/...`
references still resolve — and run `SCENARIO_CONCURRENCY` at a time (4 by
default; set it to 1 when a cloud starts throttling). The copy is removed
afterwards; the state in GCS is what persists.

Roster scenarios `for_each` over the competitor map, so one apply covers all
competitors concurrently.

## Writing one

Copy an existing directory. A scenario is:

```
scenarios/<your-id>/
  scenario.json    the manifest — see below
  main.tf          your resources
  variables.tf     copy verbatim from a scenario of the same cloud and shape
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
  "activateApis": ["container.googleapis.com"],
  "perCompetitor": false
}
```

- **`id`** must equal the directory name. It is the state prefix and the value
  stored on the run, so renaming one orphans live state — pick it carefully.
- **`cloud`** decides which cloud's checkbox list it appears in. A challenge
  runs on exactly one cloud, so only that cloud's scenarios are offered.
- **`requiresCluster`** builds that cloud's cluster layer first
  (`challenges/{gcp-per-user-gke,azure-per-user-aks,aws-per-user-eks}`) and gives
  you the network and cluster to target.
- **`activateApis`** are enabled in every competitor's project before your layer
  applies — GCP only, where enabling an API is a prerequisite. The union across
  selected scenarios is what the projects layer gets; a challenge with no
  scenarios enables only `compute.googleapis.com`, as before.
- **`perCompetitor`** picks the shape. See the table above.

### The inputs you get

`variables.tf` is identical within a cloud and shape, and written by one function
in the runner. Declare every variable even if you use none — an undeclared
variable in the tfvars is a warning on every apply.

**Roster shape** (`writeScenarioTfvars`, `writeAzureScenarioTfvars`) — maps
keyed by competitor address:

| Variable | |
| --- | --- |
| `attendee_projects` / `attendee_resource_groups` | address → their environment. Your `for_each`. |
| `network_names`, `node_tags` (GCP) | the VPC and the node tag. **Scope to the tag**, or a rule written for one competitor reaches another's environment. |
| `subnet_ids`, `cluster_names` (Azure) | the node subnet an NSG or route table attaches to. |
| `region`/`location`, `labels`, `run_id`, `scenario_id` | |

**Per-competitor shape** (`writeGcpCompetitorScenarioTfvars`,
`writeAwsCompetitorScenarioTfvars`) — the same things, singular:

| Variable | |
| --- | --- |
| `attendee_email` | whose apply this is. |
| `project_id` / `account_id` | their environment. On AWS this is what the provider assumes into. |
| `cluster_name`, `location`, `network_name`, `node_tag` | their cluster. Read it back with a data source rather than shared state. |
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
