# The cluster scenarios have no Terraform of their own

`gcp-cluster`, `aws-cluster` and `azure-cluster` are manifests and nothing else —
no `main.tf`, no state, no apply.

The cluster itself is built by that cloud's cluster layer
(`challenges/gcp-per-user-gke`, `azure-per-user-aks`, `aws-per-user-eks`), which
has always run whenever a selected scenario needed one. These manifests exist so
that "give every competitor a cluster" is something an organizer can ask for
**on its own**, rather than only as a side effect of picking a problem to inflict
on it.

So a scenario declaring `providesCluster` means: selecting this turns the
cluster layer on, and there is no layer of its own to apply. The runner skips
the apply step for it (`hasScenarioRoot`), and `scenario-catalog.test.ts`
asserts it really has no root — a stray `main.tf` here would be applied against
a state prefix nobody expects.

The dependency runs the other way too. Any scenario with `requiresCluster` pulls
the cluster scenario in automatically and locks its checkbox while it is on, in
the UI and again server-side in `withClusterScenario`. Turning the cluster off
under a scenario that needs it is not a state worth being able to express.
