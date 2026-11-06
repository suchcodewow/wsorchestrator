/**
 * What the slide review's slides are made from: themes, each a subtitle and a
 * pool of current-state problems paired with the future-state outcome that
 * answers them, and a pool of capabilities with how each is measured. A slide
 * takes one theme, five of its pairs and four or five of its capabilities, so
 * a row's two halves always belong together. Every phrase here is written
 * correctly; the mistakes are made from them by `generate.ts`.
 *
 * `SLIPS` holds the mistakes a rule can't make for itself: a grammar slip that
 * needs to know which word is the verb, and an over-long version of a headline
 * that runs over its column. Add a theme or a pair freely; the unit suite
 * checks each phrase fits its column.
 *
 * Every customer, claim and number is invented.
 */

export type Row = { head: string; sub: string };
export type Capability = { lead: string; metric: string };
export type Pair = { current: Row; future: Row };
export type Theme = { id: string; name: string; subtitle: string; pairs: Pair[]; capabilities: Capability[] };

const p = (currentHead: string, currentSub: string, futureHead: string, futureSub: string): Pair => ({
  current: { head: currentHead, sub: currentSub },
  future: { head: futureHead, sub: futureSub },
});
const c = (lead: string, metric: string): Capability => ({ lead, metric });

export const THEMES: Theme[] = [
  {
    id: "software-delivery",
    name: "Software delivery",
    subtitle: "Confirming your priorities re: Software Delivery",
    pairs: [
      p("Coding outpaces safe delivery speed", "AI coding tool investment is blocked", "Delivery keeps pace with coding", "Coding tools pay for themselves"),
      p("Code, infra and DB run on separate tools", "Time wasted on rollbacks and hotfixes", "One governed path for code, infra and DB", "Fewer failures, faster recovery"),
      p("Every change needs the same manual approval", "Velocity slowed by needless sign-offs", "Teams choose autonomy based on risk", "Teams shift from toil to innovation"),
      p("Pipelines are crafted per service", "Teams buried in toil, not high-value work", "Golden paths shared across services", "One change updates every pipeline"),
      p("Governance bolted on, not built in", "Compliance issues and risk are growing", "Governance built into every pipeline", "Compliance gaps close on their own"),
      p("Releases coordinated over spreadsheets", "Multi-service launches slip every quarter", "Multi-service releases auto-coordinated", "Launches ship on the planned date"),
      p("Rollbacks depend on a few experts", "Bad releases stay live for hours", "Deployments verified automatically", "Bad releases rolled back in minutes"),
      p("Deployment status lives in chat threads", "Nobody knows what is running where", "One view of every environment", "Everyone sees what is live, and why"),
    ],
    capabilities: [
      c("Agents generate, improve & explain pipelines", "% increase of deployments"),
      c("Agentic pipeline steps handle complexity", "# of autonomous steps"),
      c("Risk-based autonomy, consistent policy", "# of manual approvals"),
      c("Golden paths consolidate pipeline sprawl", "# of required pipelines"),
      c("Continuous verification on every deploy", "mean time to recover"),
      c("Release orchestration across services", "% of releases on schedule"),
    ],
  },
  {
    id: "continuous-integration",
    name: "Continuous integration",
    subtitle: "Confirming your priorities re: Continuous Integration & Test Intelligence",
    pairs: [
      p("Builds take 45 minutes on average", "Developers context-switch while they wait", "Builds finish in under 10 minutes", "Developers stay in flow"),
      p("Every commit runs the full test suite", "Compute spend grows with every new test", "Only the tests a change affects run", "Lower compute cost per commit"),
      p("Flaky tests block merges daily", "Engineers rerun pipelines instead of fixing", "Flaky tests quarantined automatically", "Merges are never blocked by noise"),
      p("Build scripts copied between repositories", "A single fix has to be made in 200 places", "Reusable templates for every build", "One change updates every build"),
      p("No insight into where build time goes", "Speed-up efforts are guesswork", "Build insights for every stage", "Teams know exactly what to speed up"),
      p("Build agents sit idle overnight", "Paying for capacity that does no work", "Build machines scale with demand", "Pay only for the builds that run"),
      p("Dependencies downloaded on every build", "The same packages fetched thousands of times", "Caches shared across every build", "Repeat builds start in seconds"),
      p("Failed builds explained by digging in logs", "Hours lost finding the one failing line", "AI explains why each build failed", "Fixes start the moment a build fails"),
    ],
    capabilities: [
      c("Test Intelligence selects tests by code change", "% reduction in test time"),
      c("Build cache and build intelligence", "average build duration"),
      c("Flaky test detection and quarantine", "# of blocked merges"),
      c("Pipeline templates with central governance", "# of pipeline definitions"),
      c("Autoscaling build infrastructure", "idle build-machine hours"),
      c("AI-assisted failure analysis", "time to fix a broken build"),
    ],
  },
  {
    id: "application-security",
    name: "Application security",
    subtitle: "Confirming your priorities re: Application Security & Supply Chain",
    pairs: [
      p("Scanners run late, just before release", "Issues found when they cost most to fix", "Scans run on every pull request", "Issues fixed while the code is fresh"),
      p("Results spread across nine different tools", "No single view of risk", "One shared view of every scanner", "Risk is visible in one place"),
      p("Every finding treated as critical", "Developers ignore alerts they can’t act on", "Findings ranked by reachability", "Developers fix what matters first"),
      p("No inventory of open-source components", "Exposure to new CVEs is unknown", "SBOM generated for every artifact", "Know your exposure within minutes"),
      p("Audit evidence gathered by hand", "Each audit costs weeks of engineering time", "Evidence collected automatically", "Audits become routine"),
      p("Exemptions tracked in email threads", "Nobody knows which risks were accepted", "Exemptions approved and expired in one place", "Every accepted risk has an owner"),
      p("Unsigned artifacts reach production", "Tampered builds would go unnoticed", "Every artifact signed and verified", "Only trusted builds can deploy"),
      p("Security reviews block the release train", "Teams wait days for a sign-off", "Policies enforce security as code", "Safe changes ship without waiting"),
    ],
    capabilities: [
      c("Shift-left scanning in every pipeline", "mean time to remediate"),
      c("Deduplicated findings in one format", "# of tools to review"),
      c("Reachability analysis and exemptions", "% of critical findings fixed within SLA"),
      c("SBOM and SLSA attestation for every build", "% of artifacts with provenance"),
      c("Policy as code for audit evidence", "hours spent per audit"),
      c("Artifact signing and verification", "% of deployments verified"),
    ],
  },
  {
    id: "cloud-cost",
    name: "Cloud cost",
    subtitle: "Confirming your priorities re: Cloud Cost Management",
    pairs: [
      p("Cloud bill grows faster than revenue", "Finance asks questions nobody can answer", "Spend tracked against business value", "Engineering and finance share one view"),
      p("Costs not mapped to teams or products", "No one owns the spend they create", "All spend allocated to an owner", "Teams act on the costs they create"),
      p("Idle resources run around the clock", "Paying for capacity nobody uses", "Idle resources stopped automatically", "Pay only for what runs"),
      p("Commitments bought on gut feel", "Savings plans go underused", "Commitments sized by actual usage", "Savings plans fully used"),
      p("Anomalies found when the invoice arrives", "Overruns caught a month too late", "Anomalies flagged within hours", "Overruns stopped before they grow"),
      p("Oversized instances left as provisioned", "Most servers run at a tenth of capacity", "Rightsizing recommended continuously", "Every workload sized to its demand"),
      p("Kubernetes costs are a single line item", "Clusters hide which team spends what", "Cluster costs split by namespace", "Each team sees its share of a cluster"),
      p("Budgets reviewed once a quarter", "Overspend is found after the fact", "Budgets tracked with alerts", "Teams see overspend the day it starts"),
    ],
    capabilities: [
      c("Cost perspectives and business mapping", "% of spend allocated"),
      c("AutoStopping rules for non-production", "idle hours eliminated"),
      c("Commitment orchestration", "% of commitments used"),
      c("Anomaly detection with alerts", "time to detect an anomaly"),
      c("Rightsizing recommendations", "% of workloads rightsized"),
      c("Cluster cost visibility", "% of cluster spend attributed"),
    ],
  },
  {
    id: "feature-management",
    name: "Feature management",
    subtitle: "Confirming your priorities re: Feature Management & Experimentation",
    pairs: [
      p("Releases tied to deployments", "Every launch is a high-stakes event", "Releases decoupled from deployments", "Launch when the business is ready"),
      p("Rollbacks require a full redeploy", "Bad releases stay live for hours", "Kill switch for every feature", "Bad releases turned off in seconds"),
      p("Feature impact measured weeks later", "Teams guess which changes moved the numbers", "Impact measured on every release", "Decisions backed by data"),
      p("Flags managed in config files", "Stale flags pile up as tech debt", "Flags governed in one place", "Stale flags cleaned up automatically"),
      p("No safe way to test in production", "Customers find the bugs first", "Progressive rollouts by audience", "Issues caught with 1% of users"),
      p("Experiments run in spreadsheets", "Results arrive after the decision", "Experiments built into every release", "Results guide the next decision"),
      p("Product managers wait on engineering", "Every rollout change needs a deploy", "Product owns the rollout", "Targeting changes take seconds"),
      p("Beta access managed by hand", "The wrong customers see early features", "Beta audiences targeted by rule", "The right customers try features first"),
    ],
    capabilities: [
      c("Feature flags with targeting rules", "# of deployments per release"),
      c("Automated kill switches with monitoring", "time to disable a bad feature"),
      c("Release impact metrics", "% of releases with measured impact"),
      c("Flag lifecycle management", "# of stale flags"),
      c("Progressive delivery by percentage", "% of incidents caught before full rollout"),
      c("Experimentation with statistical guardrails", "# of experiments per quarter"),
    ],
  },
  {
    id: "resilience",
    name: "Resilience",
    subtitle: "Confirming your priorities re: Resilience Testing & Incident Response",
    pairs: [
      p("Outages discovered by customers", "Revenue lost before anyone is paged", "Weaknesses found before customers do", "Revenue protected during peak traffic"),
      p("Failover never tested end to end", "Recovery plans exist only on paper", "Failover tested on every release", "Recovery plans proven in practice"),
      p("Incident response depends on heroes", "The same few engineers are always on call", "Runbooks automated with AI assistance", "Any engineer can resolve an incident"),
      p("Postmortems repeat the same causes", "Lessons learned are not acted on", "Fixes verified with repeatable experiments", "Causes stay fixed"),
      p("Reliability targets set but not tracked", "No one knows if SLOs are being met", "SLOs tracked against every change", "Releases gated on reliability"),
      p("Load tests run once before launch", "Capacity problems appear at peak", "Load tests run on every release", "Peak traffic holds no surprises"),
      p("Dependencies fail without warning", "One slow service takes down the rest", "Dependency failures injected on purpose", "Services degrade gracefully"),
      p("On-call alerts fire all night", "Engineers ignore the noise", "Alerts tied to customer impact", "Every page is worth answering"),
    ],
    capabilities: [
      c("Chaos experiments in every pipeline", "# of customer-found incidents"),
      c("Disaster recovery testing", "% of recovery time objectives met"),
      c("AI-assisted incident response", "mean time to resolve"),
      c("SLO-based release verification", "% of releases within error budget"),
      c("Load testing on every release", "% of releases load-tested"),
      c("Alert tuning tied to SLOs", "# of pages per week"),
    ],
  },
  {
    id: "developer-portal",
    name: "Developer portal",
    subtitle: "Confirming your priorities re: Internal Developer Portal & Platform Engineering",
    pairs: [
      p("New engineers take weeks to ship", "Onboarding depends on tribal knowledge", "New engineers ship in their first week", "Onboarding is self-service"),
      p("Service ownership unclear", "Incidents bounce between teams", "Every service has a clear owner", "Incidents routed to the right team"),
      p("Every team builds its own scaffolding", "Standards drift from day one", "Golden-path templates for new services", "Standards built in from day one"),
      p("Tickets needed for every environment", "Developers wait days for infrastructure", "Self-service environments on demand", "Infrastructure in minutes, not days"),
      p("Docs scattered across wikis", "Answers are hard to find and often wrong", "One home for docs and APIs", "Answers in one place, always current"),
      p("Production readiness checked by hand", "Services launch without monitoring", "Scorecards track every standard", "Gaps are visible before launch"),
      p("Platform team answers the same questions", "Their roadmap slips every quarter", "Developers serve themselves", "The platform team builds, not answers"),
      p("Tool sprawl across every team", "Paying twice for the same tool", "One portal for every tool", "Tool spend falls as usage rises"),
    ],
    capabilities: [
      c("Service directory with ownership", "% of services with an owner"),
      c("Scaffolding templates and golden paths", "time to first deployment"),
      c("Self-service workflows with guardrails", "# of infrastructure tickets"),
      c("Scorecards for production readiness", "% of services meeting standards"),
      c("TechDocs alongside the code", "developer satisfaction score"),
      c("Plugins for every tool in use", "# of tools reached from the portal"),
    ],
  },
  {
    id: "infrastructure-as-code",
    name: "Infrastructure as code",
    subtitle: "Confirming your priorities re: Infrastructure as Code & GitOps",
    pairs: [
      p("Terraform run from laptops", "No record of who changed what", "Every change runs through a pipeline", "Full audit trail for every apply"),
      p("Drift between environments", "Staging never matches production", "Drift detected and reconciled", "Environments stay in sync"),
      p("State files stored in shared buckets", "One mistake can corrupt everything", "State managed and locked centrally", "Safe, concurrent changes"),
      p("Cost of changes unknown until the bill", "Surprise spend after every rollout", "Cost estimated before every apply", "No surprises on the bill"),
      p("Policy checks done in review meetings", "Approvals take days", "Policy enforced as code", "Approvals in minutes, not days"),
      p("Modules copied between teams", "A fix in one copy never reaches the rest", "A registry of approved modules", "Fixes reach every team at once"),
      p("Clusters configured by hand", "Every cluster is slightly different", "Clusters synced from Git", "Every cluster matches its definition"),
      p("Secrets pasted into variables", "Credentials leak into plan output", "Secrets pulled from a vault", "No credential ever appears in a plan"),
    ],
    capabilities: [
      c("Infrastructure as Code Management", "% of changes through a pipeline"),
      c("Drift detection and GitOps sync", "# of drift incidents"),
      c("Remote state with locking", "# of state-related failures"),
      c("Cost estimation in pull requests", "% of changes with a cost estimate"),
      c("OPA policies on every plan", "approval lead time"),
      c("Private module registry", "% of modules from the registry"),
    ],
  },
  {
    id: "database-devops",
    name: "Database DevOps",
    subtitle: "Confirming your priorities re: Database DevOps",
    pairs: [
      p("Schema changes applied by hand", "Releases wait on a DBA’s calendar", "Schema changes delivered through pipelines", "Releases ship on the team’s schedule"),
      p("Database changes not versioned", "No way to see what changed or when", "Every database change in Git", "Full history of what changed and why"),
      p("Rollbacks require a restore from backup", "A bad migration means hours of downtime", "Automatic rollback for every migration", "Recover in minutes, not hours"),
      p("App and database released separately", "Deployments fail on schema mismatches", "App and schema released together", "No more mismatched deployments"),
      p("No checks before changes reach production", "Risky SQL found after the outage", "Policies check SQL before it runs", "Risky changes blocked early"),
      p("Test databases drift from production", "Migrations pass tests, then fail live", "Test databases built from production", "Migrations behave the same everywhere"),
      p("Every database team has its own process", "Audits find a different answer each time", "One process for every database", "Audits find one answer"),
      p("Long migrations lock busy tables", "Customers see errors during releases", "Migrations planned to avoid locks", "Releases are invisible to customers"),
    ],
    capabilities: [
      c("Database DevOps in the same pipeline", "% of schema changes automated"),
      c("Changelogs versioned in Git", "% of changes with an audit trail"),
      c("Rollback with every changeset", "mean time to recover"),
      c("Policy checks on every change", "# of failed migrations"),
      c("Drift detection across environments", "# of environments out of sync"),
      c("Migration impact analysis", "minutes of table locks per release"),
    ],
  },
  {
    id: "vulnerability-response",
    name: "Vulnerability response",
    subtitle: "Confirming your priorities re: Vulnerability Management & Runtime Protection",
    pairs: [
      p("Overwhelming volume of vulnerabilities", "More findings than security can triage", "Rank and fix issues in minutes", "A more secure production environment"),
      p("Can’t respond quickly to zero-days", "Never know exposure or what to patch", "Fast, repeatable zero-day response", "Know your exposure within minutes"),
      p("Runtime threats go unseen", "Attacks found days after they start", "Threats detected as they happen", "Attacks stopped in progress"),
      p("Patching depends on each team’s backlog", "Critical fixes wait behind features", "Patches delivered through pipelines", "Critical fixes ship the same day"),
      p("Containers run with full privileges", "One breach reaches the whole cluster", "Least privilege enforced at deploy", "A breach stays contained"),
      p("Security and engineering share no data", "Each side argues from its own report", "One shared view of every risk", "Both sides work from the same facts"),
      p("APIs launched without inventory", "Nobody knows which APIs are exposed", "Every API discovered automatically", "Exposed APIs found before attackers"),
      p("Fixes verified by asking the team", "Closed tickets reopen after the next scan", "Fixes verified by a rescan", "Closed means fixed"),
    ],
    capabilities: [
      c("Reachability-based ranking", "% of vulnerabilities fixed within SLA"),
      c("Agentic zero-day response", "zero-day mean time to remediate"),
      c("Runtime threat detection", "time to detect an attack"),
      c("Automated patch pipelines", "days to patch a critical issue"),
      c("Deploy-time security policies", "% of workloads with least privilege"),
      c("API discovery and testing", "% of APIs inventoried"),
    ],
  },
  {
    id: "test-automation",
    name: "Test automation",
    subtitle: "Confirming your priorities re: AI Test Automation",
    pairs: [
      p("UI tests break with every redesign", "Engineers spend days fixing test scripts", "Tests heal themselves when the UI changes", "Engineers write features, not fixes"),
      p("Only engineers can write tests", "Product knowledge never reaches the tests", "Anyone can write a test in plain English", "Tests cover how customers really work"),
      p("Regression suite takes two days to run", "Releases wait for the test cycle", "Regression suite runs in an hour", "Releases ship the day they are ready"),
      p("Test coverage is unknown", "Gaps appear as production bugs", "Coverage mapped to every user journey", "Gaps are closed before release"),
      p("Test data built by hand for every run", "Tests fail on stale or missing data", "Test data generated on demand", "Every run starts with fresh data"),
      p("Manual testers repeat the same checks", "Testing cost grows with every release", "Repeated checks fully automated", "Testers explore instead of repeating"),
      p("Test results buried in long reports", "Failures go unread until it is too late", "Failures explained with likely causes", "The right team sees each failure"),
      p("Mobile apps tested on a few devices", "Customers find device-specific bugs", "Tests run on every target device", "Device bugs caught before release"),
    ],
    capabilities: [
      c("AI-authored, self-healing tests", "hours spent maintaining tests"),
      c("Natural-language test authoring", "# of people writing tests"),
      c("Parallel test execution", "regression suite duration"),
      c("Journey-based coverage analysis", "% of journeys covered"),
      c("Synthetic test data generation", "# of data-related test failures"),
      c("Device cloud integration", "# of devices tested per release"),
    ],
  },
  {
    id: "service-reliability",
    name: "Service reliability",
    subtitle: "Confirming your priorities re: Service Reliability & AI SRE",
    pairs: [
      p("Incidents start with a hunt for context", "The first hour is spent finding the cause", "AI gathers context the moment it starts", "Responders begin with the likely cause"),
      p("Changes and incidents tracked separately", "Nobody links an outage to a deploy", "Every incident linked to recent changes", "The change that broke it is clear"),
      p("Status updates written by hand", "Stakeholders chase engineers for news", "Status updates drafted automatically", "Stakeholders stay informed"),
      p("Postmortems take weeks to write", "Timelines are rebuilt from memory", "Timelines captured as the incident runs", "Postmortems are ready the next day"),
      p("Monitoring tools disagree", "Each team trusts a different dashboard", "One view across every monitoring tool", "Everyone works from the same signals"),
      p("Runbooks out of date", "Steps fail halfway through an incident", "Runbooks tested and kept current", "Every step works when it is needed"),
      p("Escalation paths unclear", "The wrong team is paged first", "Escalation follows service ownership", "The right expert is paged first"),
      p("Recurring incidents never get fixed", "The same outage returns every month", "Repeat incidents tracked to a fix", "Recurring outages are eliminated"),
    ],
    capabilities: [
      c("AI SRE incident assistant", "mean time to resolve"),
      c("Change intelligence for incidents", "% of incidents linked to a change"),
      c("Automated stakeholder updates", "# of status requests per incident"),
      c("Live incident timelines", "time to publish a postmortem"),
      c("Unified observability views", "# of tools checked per incident"),
      c("Ownership-based escalation", "% of first pages to the right team"),
    ],
  },
];

/**
 * Mistakes for particular phrases, keyed by the phrase exactly as written
 * above. `grammar` is a wrong version and what is wrong with it; `long` is a
 * version too long for its column, for a headline only.
 */
export const SLIPS: Record<string, { grammar?: [wrong: string, note: string]; long?: string }> = {
  "Delivery keeps pace with coding": { grammar: ["Delivery keep pace with coding", "“Delivery keep pace” should be “Delivery keeps pace”."] },
  "Every change needs the same manual approval": {
    grammar: ["Every change need the same manual approval", "“Every change need” should be “Every change needs”."],
  },
  "Governance bolted on, not built in": { long: "Governance is bolted on at the very end instead of being built into the process" },
  "Releases coordinated over spreadsheets": { grammar: ["Releases coordinated over spreadsheet", "“spreadsheet” should be plural: there is more than one."] },
  "Compute spend grows with every new test": { grammar: ["Compute spend grow with every new test", "“Compute spend grow” should be “Compute spend grows”."] },
  "Only the tests a change affects run": { grammar: ["Only the tests a change effects run", "“effects” should be “affects”."] },
  "Builds take 45 minutes on average": { long: "Builds take 45 minutes on average and sometimes well over an hour on a busy day" },
  "No insight into where build time goes": { grammar: ["No insight into where build time go", "“build time go” should be “build time goes”."] },
  "Scans run on every pull request": { grammar: ["Scans runs on every pull request", "“Scans runs” should be “Scans run”."] },
  "Results spread across nine different tools": { long: "Results are spread across nine different scanning tools that nobody has time to check" },
  "Audit evidence gathered by hand": { grammar: ["Audit evidence gathered by hands", "“by hands” should be “by hand”."] },
  "Finance asks questions nobody can answer": { grammar: ["Finance ask questions nobody can answer", "“Finance ask” should be “Finance asks”."] },
  "All spend allocated to an owner": { grammar: ["All spend allocated to a owner", "“a owner” should be “an owner”."] },
  "Anomalies found when the invoice arrives": { long: "Anomalies are only found at the end of the month when the invoice finally arrives" },
  "Customers find the bugs first": { grammar: ["Customers finds the bugs first", "“Customers finds” should be “Customers find”."] },
  "Feature impact measured weeks later": { long: "Feature impact is only measured weeks later, long after the next release has gone out" },
  "Product managers wait on engineering": { grammar: ["Product managers waits on engineering", "“Product managers waits” should be “Product managers wait”."] },
  "The same few engineers are always on call": {
    grammar: ["The same few engineer are always on call", "“engineer” should be plural: “The same few engineers”."],
  },
  "Reliability targets set but not tracked": { long: "Reliability targets are set by leadership every quarter but are never actually tracked" },
  "Dependencies fail without warning": { grammar: ["Dependencies fails without warning", "“Dependencies fails” should be “Dependencies fail”."] },
  "Every team builds its own scaffolding": { grammar: ["Every team builds it’s own scaffolding", "“it’s” means “it is”; this should be “its”."] },
  "New engineers ship in their first week": { grammar: ["New engineers ship in there first week", "“there” should be “their”."] },
  "Tickets needed for every environment": { long: "Tickets are needed for every single environment, and each one takes several days" },
  "Terraform run from laptops": { grammar: ["Terraform ran from laptops", "“ran” should be “run”: the slide describes how things are today."] },
  "Drift detected and reconciled": { long: "Drift is detected across every single environment and then reconciled automatically by GitOps" },
  "Modules copied between teams": { grammar: ["Modules copies between teams", "“Modules copies” should be “Modules copied”."] },
  "Releases wait on a DBA’s calendar": { grammar: ["Releases waits on a DBA’s calendar", "“Releases waits” should be “Releases wait”."] },
  "Policies check SQL before it runs": { grammar: ["Policies check SQL before it run", "“it run” should be “it runs”."] },
  "No checks before changes reach production": { long: "There are no checks at all before database changes reach the production environment" },
  "Runtime threats go unseen": { grammar: ["Runtime threats goes unseen", "“threats goes” should be “threats go”."] },
  "Overwhelming volume of vulnerabilities": { long: "An overwhelming volume of vulnerabilities is discovered every week across every product" },
  "Only engineers can write tests": { grammar: ["Only engineers can writes tests", "“can writes” should be “can write”."] },
  "UI tests break with every redesign": { long: "UI tests break with every redesign, and nobody can keep up with fixing all of them" },
  "Monitoring tools disagree": { grammar: ["Monitoring tools disagrees", "“tools disagrees” should be “tools disagree”."] },
  "Incidents start with a hunt for context": { long: "Incidents start with a long hunt for context across dashboards, logs and chat threads" },
};
