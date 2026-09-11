# Harness

How to talk to the Harness account this project deploys from, and the four traps
that each cost a debugging round. None of this is in the Harness docs.

The deploy pipeline itself is described in
[DEPLOY.md](../DEPLOY.md#continuous-deployment) and mirrored at
[infra/admin/deploy-pipeline.yml](../infra/admin/deploy-pipeline.yml).

| | |
| --- | --- |
| **Account** | `8mh-FIIHQUapLuB6K0Cd-w` |
| **Org / project** | `operations` / `orchestrator` |
| **Pipeline** | `deploy_workshop_orchestrator` (stored **INLINE**) |
| **Trigger** | `deploy_on_push_main` (Webhook, enabled) |
| **IaCM workspace** | `admin_control_plane` |

---

## API access

The working PAT lives in `infra/admin/terraform.tfvars` as `harness_api_key`.
That file is git-ignored, so it exists only on machines that have been set up to
deploy. Use it for any direct REST call, as `x-api-key: <PAT>`.

> **Do not read credentials from `~/Library/Application Support/Code/User/mcp.json`.**
> The PAT in there belongs to a different account (`fjf_VfuITK2bBrMLg5xV7g`) and
> returns `403 account identifier mismatch` against this one. That file also
> points at a binary path that no longer exists — it is stale.

### REST paths that work

| Operation | Call |
| --- | --- |
| Create/update pipeline | `POST /gateway/pipeline/api/pipelines/v2` — `Content-Type: application/yaml`, raw YAML body |
| Create trigger | `POST /gateway/pipeline/api/triggers?targetIdentifier=…` |
| Enable/disable trigger | `PUT …/triggers/{id}/status?status=false` |
| Test a connector | `POST /ng/api/connectors/testConnection/{id}` |
| Create a text secret | `POST /ng/api/v2/secrets` |
| Create a file secret | `POST /ng/api/v2/secrets/files` — multipart, `file=@…` plus `spec=…` |
| Create an IaCM workspace | `POST /gateway/iacm/api/orgs/{org}/projects/{prj}/workspaces?accountIdentifier=…` |

### Where the MCP server falls short

Two gaps worth knowing before you burn an attempt on them:

- **`harness_create` has no `secret` in its `resource_type` enum.** Secrets have
  to go through REST. When you do, the scope in the JSON body **and** in the
  query string must match, or it answers
  `400 scope in payload and params do not match`.
- **`harness_create(resource_type='iacm_workspace')` returns `Operation declined
  by user`** even with `confirm: true`, while `connector` creates in the same
  batch go through. That is a permission rule, not a real decline. The REST path
  above works; it answers `{}` on success, so fetch the workspace afterwards to
  confirm.

---

## Trap 1 — IaCM plan output variables need the bracket form

An `IACMTerraformPlugin` plan step publishes output variables whose keys contain
a literal dot: `plannedChanges.added`, `.changed`, `.deleted`, `.unchanged`,
`.imported`, `.removed`, plus `driftChanges.*`, `outputs.*`, and paths for
`plan`, `parsedPlan`, and `binary`.

Only the bracket form resolves:

```
<+steps.plan.output.outputVariables['plannedChanges.deleted']>   ->  "4"
<+steps.plan.output.outputVariables.plannedChanges.deleted>      ->  null
```

Also null: the full-FQN form
(`<+pipeline.stages.<stage>.spec.execution.steps.plan.output…>`) and
`<+execution.steps.plan.output…>`, both with the dotted tail. Values are
**strings**, so compare against `"0"`, not `0`.

**Why this is worse than a normal typo:** the dotted path is read as two more
levels of map and silently resolves to null. The step still *succeeds*, so a
`when.condition` built on it quietly evaluates as though there were no changes —
the apply is skipped and nothing reports a problem.

In `deploy_workshop_orchestrator` this gates the Apply step on added / changed /
deleted all being non-`"0"`. Verified both directions: a 4-deletion plan
applied, a 0-change plan skipped.

## Trap 2 — a webhook trigger's branch input is `branch:`, not `ref:`

```yaml
properties:
  ci:
    codebase:
      build:
        type: branch
        spec:
          branch: <+trigger.branch>
```

`ref:` is rejected with
`$.pipeline.properties.ci.codebase.build.spec.branch: is missing but it is required`.

**Why this is hard to find:** the trigger still saves, still reads `enabled:
true`, and GitHub's webhook delivery still returns 200. Nothing appears in the
pipeline's execution list, so it looks exactly like a webhook that never
arrived. The failure is visible in one place only:

```
GET /pipeline/api/triggers/eventHistory/{triggerId}     # needs targetIdentifier
```

`finalStatus` reads `INVALID_RUNTIME_INPUT_YAML`. A good outcome there is
`TARGET_EXECUTION_REQUESTED`.

**After changing a trigger, check that event history rather than trusting the
save.** To retest without pushing a commit, redeliver the event GitHub already
sent:

```bash
gh api -X POST repos/suchcodewow/wsorchestrator/hooks/<id>/deliveries/<deliveryId>/attempts
```

## Trap 3 — there is no cross-project move

`move-config` only does INLINE↔REMOTE. Moving an entity between projects means
recreate at the new scope, verify, then delete at the old one. Project-scoped
references cannot be read across projects, so the whole dependency chain has to
come along: connectors, secrets, the IaCM workspace, the trigger.

**Copying IaCM OpenTofu state** is the step with real blast radius. The
`terraform-backend` endpoint is a plain HTTP backend, so basic-auth
`harness:<PAT>` GET the old and POST to the new:

```bash
BASE=https://app.harness.io/gateway/iacm/api/orgs/$ORG/projects/$PRJ
BASE=$BASE/workspaces/$WS/terraform-backend?accountIdentifier=$ACC

curl -u "harness:$PAT" "$OLD_BASE" > state.json
curl -u "harness:$PAT" -X POST -H 'Content-Type: application/json' \
     --data @state.json "$NEW_BASE"
```

POST stores verbatim, so `lineage` and `serial` survive and a later `tofu state
pull` from either side matches. Needs a PAT with `iac_workspace_accessstate`.

**Verify with a plan-only run** (`apply_infra=false`) and check that the plan
step's `plannedChanges.*` output variables are all `0`. That, not the HTTP 200,
is the evidence the copy was faithful.

**Secrets cannot be copied.** Harness never returns a stored secret's value, so
each has to be recreated from its original source. For this project: `tf_*`
values are in `infra/admin/terraform.tfvars`, the GitHub PAT mirrors GCP Secret
Manager `github-pat`, tf-admin's key is
`~/.config/gcloud/workshop-tf-admin.json`, and **build-sa's key exists nowhere on
disk** — mint a fresh one with `gcloud iam service-accounts keys create` and
revoke the superseded one once the new pipeline verifies.

**Triggers survive a move without touching GitHub.** The webhook URL is
account-level (`/gateway/ng/api/webhook?accountIdentifier=…`) and matching is by
connector plus payload conditions, so the repo's existing webhook keeps working.
Do disable the old trigger before the cutover, or both fire on the same push.

## Trap 4 — the pipeline YAML is stored inline, and the repo copy is a mirror

[infra/admin/deploy-pipeline.yml](../infra/admin/deploy-pipeline.yml) exists so
the deploy path is reviewable and diffable in git. It is **not** the source —
Harness holds the pipeline INLINE. Changing one does not change the other.

**Update both, in the same commit.** A change made only in Harness is invisible
to review; a change made only in the repo does not run.
