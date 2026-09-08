/**
 * Every provider message a real workshop run has failed on, verbatim.
 *
 * This file is the regression net. The runner's job is almost entirely reading
 * strings that AWS, GCP, Azure, Google Workspace and Harness hand back and
 * deciding whether to wait, move, or stop — and a wrong decision does not
 * degrade gracefully, it fails a workshop in front of a room. The failures this
 * project has actually had are nearly all one of these strings meeting a
 * classifier that had never seen it.
 *
 * So they are kept. Each entry records where it came from (`run` and `date`, both
 * traceable in `workshop_runs` / `run_logs`), what the runner should conclude
 * (`expect`), and why. `date` matters: an entry dated *after* the fix that was
 * supposed to handle it is a regression, and one that appears twice is a signal
 * the fix never landed — which is exactly what happened with
 * `harness-already-in-user-group` below.
 *
 * Adding to this file is the first step of fixing any new failed run, before the
 * code change. That order is deliberate: it proves the test fails for the right
 * reason, and it means the knowledge lives somewhere executable rather than in a
 * commit message nobody re-reads.
 *
 * The strings are lightly trimmed of nothing at all — request ids, ARNs, emails
 * and account numbers are left in, because that noise is precisely what a
 * substring matcher has to survive.
 */

/** What the runner is supposed to do about a message. */
export type Expectation =
  /** Wait and re-apply: the condition clears itself. */
  | "retry-warmup"
  /** Wait and re-apply: another run holds a shared, serialised resource. */
  | "retry-contention"
  /** Try a different zone: this one has no capacity. */
  | "retry-other-zone"
  /** Succeed: the API is refusing because the desired state already holds. */
  | "already-satisfied"
  /** Stop and report: a real misconfiguration a retry cannot fix. */
  | "fail";

export type ProductionFailure = {
  /** Stable id, used in test names so a failure says which scar reopened. */
  readonly id: string;
  /** `slug` of the run this came out of. */
  readonly run: string;
  /** `created_at` of that run, YYYY-MM-DD. */
  readonly date: string;
  /** HTTP status, where the message came from an HTTP reply we classify by it. */
  readonly status?: number;
  /** The message, exactly as it was logged. */
  readonly message: string;
  readonly expect: Expectation;
  /**
   * Set when this message appears during a *teardown* and can never succeed, so
   * the reaper must stop on the first attempt instead of spending its budget.
   *
   * Separate from `expect` rather than a value of it because the two answer
   * different questions about the same string: `expect` is what the apply-time
   * classifiers should conclude (here: `fail`, and it must stay in that loop),
   * and this is whether the destroy retry policy should give up immediately.
   * Every fixture without the flag is asserted *not* to be terminal, which is
   * what keeps `PERMANENT_DESTROY_SIGNATURES` from being widened by accident.
   */
  readonly permanentDestroy?: true;
  /** Why that is the right answer — the thing a future reader needs. */
  readonly because: string;
};

export const PRODUCTION_FAILURES: readonly ProductionFailure[] = [
  /* ---------------------------------------------------------------- *
   * Harness — replies that refuse a request it has already honoured
   * ---------------------------------------------------------------- */
  {
    id: "harness-already-in-project-user-group",
    run: "aws-cardinal",
    date: "2026-09-07",
    status: 400,
    message:
      '{"status":"ERROR","code":"INVALID_REQUEST","message":"Invalid request: ' +
      "Invalid format of YAML payload: HTTP Error Status (400 - Invalid Format) " +
      "received. Invalid request: User J08YRCFQRqOdvjDglAN6EA is already part " +
      'of User Group _project_all_users","correlationId":"1d3bef2f-375f-4886-b4a1-2a38a20656c8"}',
    expect: "already-satisfied",
    because:
      "POST /ng/api/user/users applied the membership and the role binding and " +
      "then refused the request. Checked against the account afterwards: " +
      "feistykumquat@harnessevents.io held _project_admin on " +
      "_all_project_level_resources in the very project the run gave up on. " +
      "Failing here abandoned the run with 5 of 10 attendees provisioned.",
  },
  {
    id: "harness-already-in-org-user-group",
    run: "aws-platform-team",
    date: "2026-08-21",
    status: 400,
    message:
      '{"status":"ERROR","code":"INVALID_REQUEST","message":"Invalid request: ' +
      "Invalid format of YAML payload: HTTP Error Status (400 - Invalid Format) " +
      "received. Invalid request: User vqSNJDCJTaax0gYN3FrC1Q is already part " +
      'of User Group _organization_all_users","correlationId":"b98f298b-d173-41c4-876c-6e788c56e5cf"}',
    expect: "already-satisfied",
    because:
      "The same defect at org scope rather than project scope, seventeen days " +
      "earlier. Two runs lost to one unhandled string is why the group name is " +
      "matched scope-agnostically instead of literally.",
  },
  {
    id: "harness-project-secret-at-org-scope",
    run: "aws",
    date: "2026-08-23",
    status: 400,
    message:
      '{"status":"ERROR","code":"INVALID_REQUEST","message":"Invalid request: ' +
      "Error while validating secretKeyRef field : Invalid request: The project " +
      'level secret cannot be used at a org level","correlationId":"6a1d86dc-a9c4-42c1-85a0-f26df0d1fec4"}',
    expect: "fail",
    because:
      "A genuine scope mistake in the catalog: an org connector referencing a " +
      "project-scoped secret. Retrying cannot fix it and treating it as a " +
      "duplicate would ship a connector that never authenticates — this is the " +
      "case that must keep failing, and it guards the entry above from being " +
      "loosened into 'any 400 mentioning a scope is fine'.",
  },

  /* ---------------------------------------------------------------- *
   * AWS — a member account that exists but is not yet usable
   * ---------------------------------------------------------------- */
  {
    id: "aws-ec2-optin-createvpc",
    run: "aws-platform",
    date: "2026-09-03",
    status: 401,
    message:
      "Error: creating EC2 VPC: operation error EC2: CreateVpc, https response " +
      "error StatusCode: 401, RequestID: f1247c1d-d91b-49df-873a-e966024bf983, " +
      "api error OptInRequired: You are not subscribed to this service. Please " +
      "go to http://aws.amazon.com to subscribe.",
    expect: "retry-warmup",
    because:
      "Organizations reports the account ACTIVE before EC2 is switched on for " +
      "it; the apply walks straight into that window.",
  },
  {
    id: "aws-ec2-optin-describe-azs",
    run: "aws-platform",
    date: "2026-09-03",
    status: 401,
    message:
      "Error: fetching Availability Zones: operation error EC2: " +
      "DescribeAvailabilityZones, https response error StatusCode: 401, " +
      "RequestID: 398e2477-4fc0-4892-9d09-efa27f94e840, api error " +
      "OptInRequired: You are not subscribed to this service. Please go to " +
      "http://aws.amazon.com to subscribe.",
    expect: "retry-warmup",
    because: "Same window, reached through a data source instead of a resource.",
  },
  {
    id: "aws-iam-invalid-token-createuser",
    run: "aws",
    date: "2026-08-23",
    status: 403,
    message:
      "Error: creating IAM User (groovywalrus@harnessevents.io): operation " +
      "error IAM: CreateUser, https response error StatusCode: 403, RequestID: " +
      "1f32e21b-04ab-4f9a-808c-a4b04f515b2b, api error InvalidClientTokenId: " +
      "The security token included in the request is invalid.",
    expect: "retry-warmup",
    because:
      "The same warm-up window seen from IAM: the access key Terraform just " +
      "created is not recognised by STS globally yet. Untreated until now, so " +
      "whichever resource the apply reached first decided whether the run " +
      "waited politely or died — this run died while OptInRequired beside it " +
      "was being retried.",
  },
  {
    id: "aws-iam-invalid-token-getuser",
    run: "nationwide-insurnace",
    date: "2026-08-25",
    status: 403,
    message:
      "Error: reading IAM User (sneakyoboe@harnessevents.io): operation error " +
      "IAM: GetUser, https response error StatusCode: 403, RequestID: " +
      "e7882df7-575b-4314-9fa3-a74969ca6a8c, api error InvalidClientTokenId: " +
      "The security token included in the request is invalid",
    expect: "retry-warmup",
    because:
      "Second run lost to the same string, two days later. Note it ends " +
      "without a full stop where the other has one — a reason to match the " +
      "error code, not the sentence.",
  },
  {
    id: "aws-iam-access-denied-orchestrator",
    run: "aws-platform",
    date: "2026-09-03",
    status: 403,
    message:
      "Error: reading IAM User (dreamypapaya@harnessevents.io): operation " +
      "error IAM: GetUser, https response error StatusCode: 403, RequestID: " +
      "d56144ae-bb01-4d38-9b09-1c718161be0e, api error AccessDenied: User: " +
      "arn:aws:iam::654129064688:user/workshop-orchestrator is not authorized " +
      "to perform: iam:GetUser on resource: user dreamypapaya@harnessevents.io " +
      "because no identity-based policy allows the iam:GetUser action.",
    expect: "fail",
    because:
      "Looks like the warm-up failures above and is not one: this is the " +
      "management account's own orchestrator user missing an IAM permission, " +
      "so it is refused identically on every attempt. Classifying a bare " +
      "AccessDenied as warm-up would spend the whole eleven-minute budget and " +
      "then report the timeout instead of the missing policy. This entry is " +
      "why 'accessdenied' is deliberately absent from the warm-up signatures.",
  },
  {
    id: "aws-org-account-delete-timeout",
    run: "jdb-test-workshop",
    date: "2026-08-27",
    message:
      "Error: waiting for AWS Organizations Account (490974068764) delete: " +
      "timeout while waiting for resource to be gone (last state: 'ACTIVE', " +
      "timeout: 10m0s)",
    expect: "fail",
    permanentDestroy: true,
    because:
      "A closed AWS account leaves the organization on AWS's own schedule, not " +
      "in ten minutes, so this destroy can never succeed as written. It must " +
      "classify as a real failure rather than something to retry — see the " +
      "unbounded teardown retry it currently feeds, which reached 572 attempts " +
      "over two days on run `aws-platform`. It opens with the same words as the " +
      "GKE capacity signature 'timeout while waiting for state to become' and " +
      "diverges at 'resource to be gone' — near enough that a future edit could " +
      "broaden one into the other, which is what the assertion on this fixture " +
      "exists to catch.",
  },

  /* ---------------------------------------------------------------- *
   * AWS — the shared management account, one operation at a time
   * ---------------------------------------------------------------- */
  {
    id: "aws-org-concurrent-modification",
    run: "(synthetic — AWS Organizations documented shape)",
    date: "2026-08-06",
    message:
      "Error: creating AWS Organizations Account: operation error " +
      "Organizations: CreateAccount, https response error StatusCode: 400, " +
      "api error ConcurrentModificationException: Another account creation " +
      "request is currently in progress. Try again later.",
    expect: "retry-contention",
    because:
      "Two workshops starting together contend on the one management account. " +
      "Marked synthetic: the signature predates run-log retention, so the " +
      "string is the provider's documented one rather than a captured line.",
  },

  /* ---------------------------------------------------------------- *
   * GCP — a zone with no room for the cluster
   * ---------------------------------------------------------------- */
  {
    id: "gke-zone-stockout",
    run: "(synthetic — GCE documented shape)",
    date: "2026-08-06",
    message:
      "Error: error creating NodePool: googleapi: Error 429: The zone " +
      "'projects/ws-demo/zones/us-central1-a' does not have enough resources " +
      "available to fulfill the request. Try a different zone, or try again " +
      "later., ZONE_RESOURCE_POOL_EXHAUSTED",
    expect: "retry-other-zone",
    because:
      "A stockout is the zone's problem, not the workshop's; another zone " +
      "usually has room, so the runner moves rather than failing.",
  },
  {
    id: "gke-create-timeout",
    run: "(synthetic — bounded create_timeout shape)",
    date: "2026-08-06",
    message:
      "Error: timeout while waiting for state to become 'DONE' (last state: " +
      "'RUNNING', timeout: 20m0s)",
    expect: "retry-other-zone",
    because:
      "A capacity-starved zone does not error, it retries the first node " +
      "internally until the bounded create_timeout fires. Same remedy as an " +
      "explicit stockout: try elsewhere.",
  },

  /* ---------------------------------------------------------------- *
   * Terraform / OpenTofu — config and state faults, never retryable
   * ---------------------------------------------------------------- */
  {
    id: "tofu-for-each-unknown",
    run: "aws-platform-team",
    date: "2026-08-20",
    message:
      "Error: Invalid for_each argument\n\n  on ../../modules/eks/main.tf line " +
      '180, in resource "aws_eks_access_entry" "attendees":\n 180: for_each = ' +
      "toset(var.attendee_principal_arns)\n\nThe \"for_each\" set includes " +
      "values derived from resource attributes that cannot be determined until " +
      "apply, and so OpenTofu cannot determine the full set of keys that will " +
      "identify the instances of this resource.",
    expect: "fail",
    because:
      "A static Terraform authoring error — the same input fails the same way " +
      "every time. It reached a live workshop only because nothing plans the " +
      "modules before a run does; a plan in CI catches this class outright, " +
      "with no cloud account involved.",
  },
  {
    id: "tofu-state-lock-held",
    run: "nationwide-platform-team",
    date: "2026-08-08",
    message:
      "Error: Error acquiring the state lock\n\nError message: writing " +
      '"gs://events-ws-tfstate/workshops/667c6cdf-3676-49d3-af6d-40532f69ef71/azure/default.tflock" ' +
      "failed: googleapi: Error 412: At least one of the pre-conditions you " +
      "specified did not hold., conditionNotMet\nLock Info:\n  ID: " +
      "1786234898762790\n  Operation: OperationTypeApply\n  Who: root@localhost",
    expect: "fail",
    because:
      "A lock left behind by a killed run — the holder is `root@localhost` in a " +
      "container that no longer exists, so waiting achieves nothing. Wants a " +
      "deliberate force-unlock of the run's own stale lock, not a retry; until " +
      "then it must stay a visible failure rather than a silent loop.",
  },

  /* ---------------------------------------------------------------- *
   * GCP — an API not yet on in a freshly created project
   * ---------------------------------------------------------------- */
  {
    id: "gcp-service-disabled",
    run: "cloud-run-demo",
    date: "2026-07-27",
    message:
      "Error: Error creating Service: googleapi: Error 403: Cloud Run Admin " +
      "API has not been used in project ws-cloud-run-demo-797c02 before or it " +
      'is disabled. ... "reason": "SERVICE_DISABLED"',
    expect: "fail",
    because:
      "The project needs the API enabled in its own Terraform, with a wait for " +
      "propagation. Retrying the apply blind would sometimes paper over it and " +
      "sometimes not, which is worse than a clear failure naming the API.",
  },
];

/** Lookup by id, so a test can name the exact scar it is guarding. */
export function failure(id: string): ProductionFailure {
  const found = PRODUCTION_FAILURES.find((f) => f.id === id);
  if (!found) throw new Error(`no production failure fixture named ${id}`);
  return found;
}

/** Every fixture the runner is supposed to reach a given conclusion about. */
export function expecting(expect: Expectation): readonly ProductionFailure[] {
  return PRODUCTION_FAILURES.filter((f) => f.expect === expect);
}
