# Testing the orchestrator

Written after `aws-cardinal` (2026-09-07) failed halfway through its roster on a
Harness reply that meant "already done". The same reply had failed
`aws-platform-team` on 2026-08-21. Nothing in between changed, because nothing
in this repository could notice.

That is the actual reliability problem. Not that the clouds are flaky — they are,
and always will be — but that **every lesson learned from a failed run has been
stored in a comment**. Comments do not fail a build. So each fix held only for as
long as someone remembered it, and the same string came back seventeen days
later and cost another workshop.

## What the failures actually are

Every provisioning failure in `workshop_runs` to date, by cause:

| Cause | Runs hit | Where it is decided | Testable without a cloud? |
| --- | --- | --- | --- |
| A partner API refuses something it already did | 3 | `isDuplicate` | **Yes** |
| A new cloud identity is not usable yet | 4 | `awsRetryKind` | **Yes** |
| A zone has no capacity | — | `isGkeCapacityError` | **Yes** |
| Static Terraform error | 1 | `tofu validate` / `plan` | **Yes** |
| Stale state lock from a killed run | 2 | nothing yet | Partly |
| Teardown retried forever on an impossible destroy | 2 | `reap.ts` | **Yes** |
| An API not yet enabled in a fresh project | 1 | Terraform | No |

The shape of that table is the finding. Nearly every failure is **a pure function
reading a string and reaching the wrong conclusion** — and until now not one of
those functions had a single test. Not one. `npm run typecheck` existed in
`runner/package.json` and nothing ever ran it; the runner ships raw TypeScript
executed by `tsx`, so there was no compile step of any kind between a commit and
a live workshop.

## Layer 1 — the classifiers (in place)

`runner/test/` runs on every build. 82 tests, ~90ms, no cloud, no database, no
credentials.

The centre of it is `test/fixtures/production-failures.ts`: **the verbatim text of
every message a real run has died on**, each tagged with the run and date it came
from and the verdict the runner should reach. The tests are a loop over that
corpus. Its value is not cleverness, it is that an August failure cannot recur in
October without going red first.

Also covered, because they are equally pure and equally consequential:

- `harnessIdentifier` / `orgIdentifier` / `projectIdentifier` — asserted against
  Harness's own identifier regex over real workshop names and adversarial ones
  (reserved words, leading digits, combining marks, 200 characters, emoji).
  Teardown recomputes these from the name, so instability here orphans an org.
- `retry.ts` — that a refusal comes back **unchanged and immediately** (the
  409-means-already-exists path in `directory.ts` depends on it), and that
  Google's HTML error page is recognised as the 5xx it is.

Two rules are deliberately duplicated between the runner and the frontend, and
both files say they are meant to agree. `harness-errors.test.ts` and
`identifier.test.ts` now run one corpus through **both copies** and fail if they
drift. That is what makes the duplication safe rather than a slow leak.

### The workflow this is for

When a run fails on a provider message, **add the fixture before the fix**:

1. Paste the verbatim message into `production-failures.ts` with its run, date,
   expected verdict, and why.
2. Run `npm test` in `runner/`. It must fail, and for the right reason.
3. Fix the classifier. It must pass.

The order matters. It proves the test exercises the real defect, and it puts the
knowledge somewhere executable instead of in a commit message nobody re-reads. A
fixture dated *after* a fix that was meant to handle it is a regression; one that
appears twice means the fix never landed. Both of those are visible now.

## Layer 2 — static checks (in place)

- The Harness pipeline `deploy_workshop_orchestrator` gains a **Verify stage**,
  first, ahead of the infrastructure apply and both image builds: `npm ci &&
  npm run verify` in `runner/`. This is the gate that was missing entirely, and
  it is on the path a push to main actually takes.

  Worth being explicit about why it took two tries to put it in the right place:
  a `verify` step was first added to `cloudbuild.yaml`, which reads like the
  deploy path and no longer is. The Cloud Build trigger was removed when CD moved
  to Harness, so that step gates only `make images`. **A test that cannot fail a
  deploy is a comment.** That is the same failure mode this whole document is
  about, one level up. The step is kept there anyway — `make images` is the
  break-glass route for when Harness is down — but the pipeline is the gate.

  The pipeline is stored INLINE in Harness and so was not in the repository at
  all: unreviewable, undiffable, and no record of who changed the deploy path or
  when. It is now mirrored at `infra/admin/deploy-pipeline.yml`. That is a mirror
  and not the source, which is a weakness; converting the pipeline to a
  git-backed (REMOTE) definition would remove the class of drift entirely and is
  the right next move on this file.

  **The gate was checked against a failing commit, not just a passing one.** A
  green stage that cannot go red is worth nothing, so a throwaway branch with one
  deliberately false assertion was run through the pipeline (run 14,
  2026-09-07): Verify failed, and `infra` and `build_migrate_deploy` both
  reported `Skipped`. Nothing was applied, built, pushed, or deployed. Worth
  repeating that check if the pipeline's stage conditions are ever edited — it is
  a minute of work and it is the only thing that distinguishes a gate from a
  decoration.
- `runner/Dockerfile` now runs `tofu validate` on all ten Terraform roots
  alongside the `tofu init` it already did. Free, and fails the image instead of
  a workshop. This one runs inside the image build, so it gates both paths
  already.

`tofu validate` does not catch everything. The `Invalid for_each argument` that
killed `aws-platform-team` on 2026-08-20 is a *plan*-time error over apply-time
values, and needs a real plan against real credentials — see layer 3.

## Layer 3 — a nightly run against the real APIs (recommended next)

Layers 1 and 2 cannot catch a partner API changing its behaviour, which is what
both Harness failures were. Only talking to it can.

The mechanism already exists: **`harness_only` sandbox mode**. It creates an org,
the attendee role, one project, and the role bindings — the exact sequence that
failed on 2026-09-07 — and touches no cloud account, so it costs a few seconds
and nothing per night.

Recommended: a Cloud Scheduler job that starts a `harness_only` run against a
throwaway workshop name, asserts it reaches `ready`, and tears it down. Today's
bug would have surfaced within 24 hours, on a name nobody was presenting to.

Worth adding beside it, in rough order of value per unit of effort:

1. **A `tofu plan` of each root against real credentials**, nightly. Catches the
   `for_each` class and any provider-version drift, without creating anything.
2. **A full one-attendee workshop per cloud**, weekly. The only thing that
   exercises account creation, the warm-up windows, and teardown end to end.
   Time-box it and alert on the failure, not the duration.
3. **Assert on the run's outputs, not just its status.** `ready` currently means
   "no step threw". It should mean the attendee has a project, a role binding,
   and a working credential — which is what an attendee will find out for us
   otherwise. The check against the Harness account that confirmed today's
   diagnosis (`_project_admin` on `_all_project_level_resources`) is exactly the
   assertion worth automating.

## Two defects this investigation surfaced

**Teardown retried forever — fixed.** `reap.ts` caught any destroy failure and left
the run for the next tick, with no attempt cap and no backoff. A closed AWS account
leaves its organization on AWS's schedule, not within the provider's 10-minute
wait, so `aws_organizations_account` destroy can never succeed — and the reaper
kept trying. Run `aws-platform` logged **572 destroy attempts over two days**;
`zone-b-dfae0a` had been `destroying` since 2026-08-06.

`destroy-policy.ts` now bounds it: a failure that cannot succeed
(`PERMANENT_DESTROY_SIGNATURES`) stops on attempt 1, everything else backs off
5m → 10m → 20m → … through a budget of eight attempts spanning about ten hours, and
the run then lands in a terminal `destroy_failed` with the error stored on the row
and a **Retry teardown** button on its page. Two details carry most of the weight:

- `reapableRuns` had to exclude `destroy_failed` **explicitly**. Its first clause is
  `delete_requested`, which is what started the teardown, so a terminal status alone
  would not have stopped the loop — the run would still have been handed back every
  tick. A terminal state you can still be selected out of is not terminal.
- `"timeout while waiting for resource to be gone"` (terminal) and
  `"timeout while waiting for state to become"` (a starved GKE zone — move and
  retry) share five words and have opposite verdicts. `classify.test.ts` asserts
  each against the other's classifier so neither can be widened into the other, and
  every fixture *not* marked `permanentDestroy` is asserted to stay retryable. The
  asymmetry is the point: a false negative costs a few retries, a false positive
  walks away from a cloud account that is still billing.

The wedged runs were deliberately **not** backfilled to `destroy_failed`. They keep
a zero counter and work through the new budget, so the reason recorded on the row is
the one they actually hit rather than one guessed at migration time.

**Teardown reads IAM with the wrong credentials — still open.** During `aws-platform`'s
destroy, `iam:GetUser` on the attendee users was refused as
`arn:aws:iam::654129064688:user/workshop-orchestrator is not authorized` — that
is the *management* account's user reaching for resources that live in the member
account, rather than assuming a role into it. Pinned as a fixture
(`aws-iam-access-denied-orchestrator`) with `expect: "fail"`, because the
tempting fix — adding `accessdenied` to the warm-up signatures — would convert a
missing IAM policy into an eleven-minute wait that then reports the wrong cause.

## Running it

```sh
cd runner
npm test          # the suite, ~90ms
npm run test:watch
npm run verify    # typecheck + tests, what CI runs
```
