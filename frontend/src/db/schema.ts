/** Every table, enum and limit in the database. */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  uuid,
  bigserial,
  primaryKey,
  pgEnum,
  index,
  uniqueIndex,
  check,
  customType,
  date,
  doublePrecision,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";
import type { DeployedContent } from "@/lib/harness-deploy-selection";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const themePreference = pgEnum("theme_preference", THEME_PREFERENCES);

/**
 * The event area's roles, lowest first — `lib/roles.ts` compares by position.
 * The database type keeps its original name, `site_role`, from before the
 * site had more than one functional area.
 */
export const EVENT_ROLES = [
  "none",
  "contributor",
  "operator",
  "manager",
  "administrator",
] as const;
export type EventRole = (typeof EVENT_ROLES)[number];

export const eventRole = pgEnum("site_role", EVENT_ROLES);

/** The training area's roles, lowest first. No role at all is no access. */
export const TRAINING_ROLES = ["viewer", "administrator"] as const;
export type TrainingRole = (typeof TRAINING_ROLES)[number];

export const trainingRole = pgEnum("training_role", TRAINING_ROLES);

/** The eVals area's roles, lowest first. No role at all is no access. */
export const EVALS_ROLES = ["viewer", "administrator"] as const;
export type EvalsRole = (typeof EVALS_ROLES)[number];

export const evalsRole = pgEnum("evals_role", EVALS_ROLES);

export const CALENDAR_SCOPES = ["own", "all"] as const;
export type CalendarScope = (typeof CALENDAR_SCOPES)[number];

export const calendarScope = pgEnum("calendar_scope", CALENDAR_SCOPES);

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  themePreference: themePreference("theme_preference")
    .notNull()
    .default("system"),
  eventRole: eventRole("site_role").notNull().default("none"),
  trainingRole: trainingRole("training_role"),
  evalsRole: evalsRole("evals_role"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  calendarScope: calendarScope("calendar_scope").notNull().default("own"),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

export const runStatus = pgEnum("run_status", [
  "requested",
  "provisioning",
  "applying",
  "ready",
  "destroying",
  "destroy_failed",
  "destroyed",
  "failed",
  "scheduled",
]);

export const CLOUDS = ["aws", "azure", "gcp"] as const;
export type Cloud = (typeof CLOUDS)[number];

export const CLOUD_LABELS: Record<Cloud, string> = {
  aws: "Amazon Web Services",
  azure: "Azure",
  gcp: "Google Cloud Platform",
};

export const EVENT_MODES = ["workshop", "challenge"] as const;
export type EventMode = (typeof EVENT_MODES)[number];

export const eventMode = pgEnum("event_mode", EVENT_MODES);

export const MAX_USERS = 50;

export const EVENT_LIMITS: Record<
  EventMode,
  { maxUsers: number; defaultUsers: number; minClouds: number; maxClouds: number }
> = {
  workshop: {
    maxUsers: MAX_USERS,
    defaultUsers: 10,
    minClouds: 0,
    maxClouds: CLOUDS.length,
  },
  challenge: { maxUsers: 5, defaultUsers: 1, minClouds: 1, maxClouds: 1 },
};

export const limitsFor = (mode: EventMode) => EVENT_LIMITS[mode];

/**
 * The scenario catalog lives in its own import-free module so the runner's
 * tests can load it and check it against the Terraform manifests it mirrors.
 * Re-exported here because this is where the rest of the event vocabulary
 * (`CLOUDS`, `EVENT_MODES`, `EVENT_LIMITS`) lives, and callers should not have
 * to know which of the two files a constant came from.
 */
export {
  SCENARIOS,
  isScenarioId,
  scenariosForCloud,
  scenariosForClouds,
  type ScenarioId,
} from "@/lib/scenario-catalog";

// Also imported, not just re-exported: the runs table below types its column
// with it.
import type { ScenarioId } from "@/lib/scenario-catalog";

export const DAY_SECONDS = 24 * 60 * 60;

export const DEFAULT_TTL_DAYS = 1;
export const MAX_TTL_DAYS = 3;

export const EXTENSION_SECONDS = DAY_SECONDS;

export function editabilityOf(status: RunStatus): "full" | "grow" | "locked" {
  if (status === "scheduled") return "full";
  if (status === "ready") return "grow";
  return "locked";
}

export const workshopRuns = pgTable(
  "workshop_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    mode: eventMode("mode").notNull().default("workshop"),
    slug: text("slug").notNull(),
    userCount: integer("user_count").notNull(),
    clouds: text("clouds").array().$type<Cloud[]>().notNull().default([]),
    /**
     * Scenario ids the organizer has selected — desired state, which the runner
     * reconciles against what it has actually built. Ids rather than a foreign
     * key: the catalog is code that ships in the runner's image (see
     * `SCENARIOS`), and a long-lived run may name one a later build no longer
     * has.
     */
    scenarios: text("scenarios").array().$type<ScenarioId[]>().notNull().default([]),
    status: runStatus("status").notNull().default("scheduled"),
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
    orgUnitPath: text("org_unit_path"),
    gcpProjectId: text("gcp_project_id"),
    statePrefix: text("state_prefix").notNull(),
    harnessOnly: boolean("harness_only").notNull().default(false),
    componentSetId: uuid("component_set_id").references(
      (): AnyPgColumn => harnessComponentSets.id,
      { onDelete: "set null" },
    ),
    outputs: jsonb("outputs"),
    error: text("error"),
    ttlSeconds: integer("ttl_seconds")
      .notNull()
      .default(DEFAULT_TTL_DAYS * DAY_SECONDS),
    deleteRequested: boolean("delete_requested").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    destroyAttempts: integer("destroy_attempts").notNull().default(0),
    /** Set while a teardown attempt owns this run; see `claimDestroy`. */
    destroyStartedAt: timestamp("destroy_started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    destroyedAt: timestamp("destroyed_at", { withTimezone: true }),
    /**
     * The deployment that created this run, and the only one allowed to act on
     * it. Null on rows from before the column, which belong to the database
     * they are in. QA can import a production backup (see
     * `lib/production-import.ts`), and every row that import brings over is
     * stamped `production`, so QA's runner and app leave those workshops alone.
     */
    environment: text("environment"),
  },
  (t) => [
    index("workshop_runs_reaper_idx").on(t.status, t.expiresAt),
    index("workshop_runs_user_idx").on(t.userId, t.createdAt),
    index("workshop_runs_scheduler_idx").on(t.status, t.scheduledStart),
  ],
);

export const CLAIM_LIMITS = { name: 80, from: 80, vacation: 120 } as const;

export const workshopAccounts = pgTable(
  "workshop_accounts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workshopRuns.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    tempPassword: text("temp_password").notNull(),
    azureAccessPass: text("azure_access_pass"),
    azureAccessPassExpiresAt: timestamp("azure_access_pass_expires_at", {
      withTimezone: true,
    }),
    claimedName: text("claimed_name"),
    claimedFrom: text("claimed_from"),
    claimedVacation: text("claimed_vacation"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("workshop_accounts_run_idx").on(t.runId, t.id)],
);

export const runLogs = pgTable(
  "run_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workshopRuns.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    stream: text("stream").notNull(),
    message: text("message").notNull(),
  },
  (t) => [index("run_logs_run_idx").on(t.runId, t.id)],
);

export const RESOURCE_KINDS = [
  "org_unit",
  "accounts",
  "harness_org",
  "harness_projects",
  "gcp_project",
  "gke_cluster",
  "azure_resource_group",
  "aks_cluster",
  "aws_account",
  "eks_cluster",
  "harness_delegate",
  "harness_secret",
  "harness_connector",
  "harness_template",
  "harness_components",
  "harness_repos",
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const runResources = pgTable(
  "run_resources",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workshopRuns.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    key: text("key").notNull().default(""),
    label: text("label").notNull(),
    detail: text("detail"),
    url: text("url"),
    done: integer("done"),
    total: integer("total"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("run_resources_run_idx").on(t.runId, t.id),
    uniqueIndex("run_resources_identity_idx").on(t.runId, t.kind, t.key),
  ],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    source: text("source").notNull().default("manual"),
    prefix: text("prefix").notNull().unique(),
    tokenHash: text("token_hash").notNull(),
    /** Null for a token that never expires; only old bundle tokens carry one. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("api_tokens_user_idx").on(t.userId, t.createdAt)],
);

/**
 * A link that gives whoever follows it, and signs in, the roles it names —
 * as long as they have no access yet. Null means that area is not granted.
 * Only the token's hash is kept; the link itself is shown once.
 */
export const userInvites = pgTable(
  "user_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    eventRole: eventRole("event_role"),
    trainingRole: trainingRole("training_role"),
    evalsRole: evalsRole("evals_role"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    uses: integer("uses").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("user_invites_created_by_idx").on(t.createdBy, t.createdAt)],
);

export const INVITE_TTL_MINUTES = 15;

export const TOKEN_NAME_MAX = 80;

export const MAX_TOKENS_PER_USER = 5;

export const harnessTokens = pgTable(
  "harness_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    accountId: text("account_id").notNull(),
    accountName: text("account_name"),
    principal: text("principal"),
    principalType: text("principal_type"),
    tail: text("tail").notNull(),
    fingerprint: text("fingerprint").notNull(),
    secret: bytea("secret").notNull(),
    permissions: jsonb("permissions")
      .$type<HarnessPermissionCheck[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    deployedOrgName: text("deployed_org_name"),
    deployedOrgIdentifier: text("deployed_org_identifier"),
    deployedAt: timestamp("deployed_at", { withTimezone: true }),
    /** What went into that organization, null for a token never deployed with. */
    deployedContent: jsonb("deployed_content").$type<DeployedContent>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("harness_tokens_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("harness_tokens_fingerprint_idx").on(t.userId, t.fingerprint),
  ],
);

export type HarnessPermissionCheck = {
  permission: string;
  resourceType: string;
  permitted: boolean;
};

export const MAX_HARNESS_TOKENS_PER_USER = 10;

export type HarnessToken = typeof harnessTokens.$inferSelect;

export const COMPONENT_KINDS = [
  "secret_text",
  "secret_file",
  "connector",
  "template",
] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const COMPONENT_SCOPES = ["org", "project"] as const;
export type ComponentScope = (typeof COMPONENT_SCOPES)[number];

export const COMPONENT_SET_STATUSES = [
  "testing",
  "submitted",
  "approved",
  "rejected",
] as const;
export type ComponentSetStatus = (typeof COMPONENT_SET_STATUSES)[number];

export const harnessComponentSets = pgTable(
  "harness_component_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    status: text("status").notNull().default("testing"),
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("harness_component_sets_status_idx").on(t.status, t.updatedAt)],
);

export const harnessComponents = pgTable(
  "harness_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setId: uuid("set_id").references(() => harnessComponentSets.id, {
      onDelete: "cascade",
    }),
    identifier: text("identifier").notNull(),
    kind: text("kind").notNull(),
    scope: text("scope").notNull().default("org"),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    spec: jsonb("spec").notNull(),
    requires: jsonb("requires").notNull().default([]),
    dependsOn: jsonb("depends_on").notNull().default([]),
    versionLabel: text("version_label").notNull().default("1"),
    builtin: boolean("builtin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("harness_components_baseline_idx")
      .on(t.identifier)
      .where(sql`set_id is null`),
    uniqueIndex("harness_components_set_idx")
      .on(t.setId, t.identifier)
      .where(sql`set_id is not null`),
    index("harness_components_set_list_idx").on(t.setId, t.identifier),
  ],
);

export const labGuides = pgTable(
  "lab_guides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    body: text("body").notNull().default(""),
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("lab_guides_updated_at_idx").on(t.updatedAt)],
);

export const LAB_GUIDE_LIMITS = {
  title: 200,
  summary: 300,
  body: 200_000,
} as const;

export const labWorkshops = pgTable(
  "lab_workshops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    published: boolean("published").notNull().default(false),
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("lab_workshops_published_idx").on(t.published, t.updatedAt)],
);

export const labWorkshopGuides = pgTable(
  "lab_workshop_guides",
  {
    workshopId: uuid("workshop_id")
      .notNull()
      .references(() => labWorkshops.id, { onDelete: "cascade" }),
    guideId: uuid("guide_id")
      .notNull()
      .references(() => labGuides.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workshopId, t.guideId] }),
    index("lab_workshop_guides_order_idx").on(t.workshopId, t.position),
    index("lab_workshop_guides_guide_idx").on(t.guideId),
  ],
);

export const LAB_WORKSHOP_LIMITS = {
  title: 200,
  summary: 300,
  guides: 50,
} as const;

export const labImages = pgTable(
  "lab_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    alt: text("alt").notNull().default(""),
    mimeType: text("mime_type").notNull(),
    bytes: integer("bytes").notNull(),
    data: bytea("data").notNull(),
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("lab_images_created_at_idx").on(t.createdAt)],
);

export const LAB_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export const LAB_IMAGE_LIMITS = {
  name: 200,
  alt: 300,
  bytes: 5 * 1024 * 1024,
} as const;

export const allowedEmailDomains = pgTable(
  "allowed_email_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    domain: text("domain").notNull(),
    note: text("note").notNull().default(""),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("allowed_email_domains_domain_idx").on(t.domain)],
);

export const ALLOWED_DOMAIN_LIMITS = { domain: 253, note: 200 } as const;

export type AllowedEmailDomain = typeof allowedEmailDomains.$inferSelect;

export const ORG_SECRET_KINDS = ["text", "file"] as const;
export type OrgSecretKind = (typeof ORG_SECRET_KINDS)[number];

export const harnessOrgSecrets = pgTable(
  "harness_org_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Whose secret it is, or null for the site's own. */
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    identifier: text("identifier").notNull(),
    kind: text("kind").notNull(),
    fileName: text("file_name"),
    bytes: integer("bytes").notNull(),
    secret: bytea("secret").notNull(),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One value per name within an owner. Two indexes rather than one on
    // (user_id, identifier), because Postgres treats nulls as distinct and so
    // would let two site-wide rows share a name.
    uniqueIndex("harness_org_secrets_identifier_idx")
      .on(t.identifier)
      .where(sql`${t.userId} is null`),
    uniqueIndex("harness_org_secrets_user_identifier_idx")
      .on(t.userId, t.identifier)
      .where(sql`${t.userId} is not null`),
  ],
);

export const ORG_SECRET_LIMITS = {
  identifier: 128,
  fileName: 255,
  bytes: 256 * 1024,
} as const;

export type HarnessOrgSecret = typeof harnessOrgSecrets.$inferSelect;

export const harnessTemplateSources = pgTable(
  "harness_template_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Whose source it is, or null for the site's own. */
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    accountId: text("account_id").notNull(),
    accountName: text("account_name"),
    orgIdentifier: text("org_identifier").notNull(),
    orgName: text("org_name"),
    projectIdentifier: text("project_identifier").notNull().default(""),
    projectName: text("project_name"),
    tail: text("tail").notNull(),
    fingerprint: text("fingerprint").notNull(),
    secret: bytea("secret").notNull(),
    addedBy: text("added_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // As with org secrets, one index per owner kind, since a nullable user_id
    // inside a single index would not hold the site's own rows apart.
    uniqueIndex("harness_template_sources_idx")
      .on(t.fingerprint, t.orgIdentifier, t.projectIdentifier)
      .where(sql`${t.userId} is null`),
    uniqueIndex("harness_template_sources_user_idx")
      .on(t.userId, t.fingerprint, t.orgIdentifier, t.projectIdentifier)
      .where(sql`${t.userId} is not null`),
  ],
);

/** The limit is per owner: the site has its own, and so does each user. */
export const MAX_TEMPLATE_SOURCES = 25;

export type HarnessTemplateSource = typeof harnessTemplateSources.$inferSelect;

/**
 * Where a workshop's copy of a repository lands: once in the event's
 * organization, or once inside every attendee's own project.
 */
export const REPO_SCOPES = ["org", "project"] as const;
export type RepoScope = (typeof REPO_SCOPES)[number];

export const harnessRepos = pgTable(
  "harness_repos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The GitHub URL an administrator typed, kept verbatim to show back. */
    url: text("url").notNull(),
    /** The `owner/name` the Harness importer takes, parsed out of the URL. */
    providerRepo: text("provider_repo").notNull(),
    /** What the repository is called once it is in Harness. */
    identifier: text("identifier").notNull(),
    scope: text("scope").notNull(),
    addedBy: text("added_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One name per scope. Harness keeps org repos and project repos in separate
    // spaces, so the same name at both levels is legal — two rows for the same
    // name at the *same* level is only ever a mistake.
    uniqueIndex("harness_repos_identifier_idx").on(t.identifier, t.scope),
  ],
);

export const REPO_LIMITS = { url: 500, identifier: 100 } as const;

export type HarnessRepo = typeof harnessRepos.$inferSelect;

export const harnessDeployedSecrets = pgTable(
  "harness_deployed_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenId: uuid("token_id").references(() => harnessTokens.id, {
      onDelete: "set null",
    }),
    accountId: text("account_id").notNull(),
    orgIdentifier: text("org_identifier").notNull(),
    secretIdentifier: text("secret_identifier").notNull(),
    kind: text("kind").notNull(),
    harnessUpdatedAt: timestamp("harness_updated_at", { withTimezone: true }),
    writtenAt: timestamp("written_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    scrubAfter: timestamp("scrub_after", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    note: text("note"),
  },
  (t) => [
    uniqueIndex("harness_deployed_secrets_idx").on(
      t.accountId,
      t.orgIdentifier,
      t.secretIdentifier,
    ),
    index("harness_deployed_secrets_due_idx").on(t.status, t.scrubAfter),
  ],
);

export const SCRUB_STATUSES = [
  "pending",
  "scrubbed",
  "skipped",
  "failed",
] as const;
export type ScrubStatus = (typeof SCRUB_STATUSES)[number];

export type HarnessDeployedSecret = typeof harnessDeployedSecrets.$inferSelect;

/**
 * Every active HiBob employee, as of the last sync. A sync replaces the whole
 * table, so someone who has left drops out. Until 0034 this was
 * `hibob_employees`, a name a view still answers to for the revision a deploy
 * replaces.
 */
export const employees = pgTable(
  "employees",
  {
    /** HiBob's own id for the person. */
    id: text("id").primaryKey(),
    /** Lowercased. */
    email: text("email").notNull(),
    /** First and last name as the email has them (`nameFromEmail`), not HiBob's full name. */
    fullName: text("full_name").notNull(),
    /** The readable title, not HiBob's numeric code for it. */
    title: text("title").notNull().default(""),
    department: text("department").notNull().default(""),
    site: text("site").notNull().default(""),
    /** Lowercased; empty for someone who reports to nobody. */
    reportsToEmail: text("reports_to_email").notNull().default(""),
    reportsToName: text("reports_to_name").notNull().default(""),
    /** First day at the company. */
    startDate: date("start_date", { mode: "string" }),
    /** When their current position took effect — a transfer resets it. */
    activeEffectiveDate: date("active_effective_date", { mode: "string" }),
    /** The record as HiBob sent it, less the flattened `/…` duplicates. */
    raw: jsonb("raw").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Links between this person and the Organization Leader, counting the
     * leader, as the sync that stored them worked it out; null for anyone not
     * under the leader. Who has one is who the Organization tab lists.
     */
    orgDepth: integer("org_depth"),
    /**
     * Lowercased emails from this person's manager up to and including the
     * Organization Leader, joined with `;` as the Sheet's Management Chain
     * column was. Set alongside `orgDepth`, and null wherever it is.
     */
    managementChain: text("management_chain"),
    /**
     * Null for anyone not under the leader. Otherwise, first that applies:
     * the track an administrator set by hand (`employee_track_overrides`);
     * `exempt` when their bootcamp history marks BTC or INT exempt; `ignored`
     * for a title on the Ignored list; `deferred` for someone who started too
     * close to the next bootcamp to attend it; then `sales` or `engineer` by
     * their title's list. Null for a title on no list. Who has `sales`,
     * `engineer`, `deferred` or none is who the Cohorts page's Current tab
     * lists. Set by `lib/evals/tracks.ts`.
     */
    track: text("track").$type<EmployeeTrack>(),
  },
  (t) => [
    index("employees_email_idx").on(t.email),
    index("employees_reports_to_idx").on(t.reportsToEmail),
  ],
);

export type Employee = typeof employees.$inferSelect;

export const HIBOB_SYNC_TRIGGERS = ["schedule", "manual"] as const;
export type HibobSyncTrigger = (typeof HIBOB_SYNC_TRIGGERS)[number];

export const HIBOB_SYNC_STATUSES = ["running", "succeeded", "failed"] as const;
export type HibobSyncStatus = (typeof HIBOB_SYNC_STATUSES)[number];

/** One HiBob sync, scheduled or manual, and how it ended. */
export const hibobSyncRuns = pgTable(
  "hibob_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trigger: text("trigger").$type<HibobSyncTrigger>().notNull(),
    /** Who pressed the button; null for a scheduled run. */
    triggeredBy: text("triggered_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /** `running` until it ends; one that never ends was cut off mid-sync. */
    status: text("status").$type<HibobSyncStatus>().notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Employees stored, on success. */
    employeeCount: integer("employee_count"),
    /** Records HiBob sent with no id or email, or a repeated id. */
    skipped: integer("skipped"),
    /** Why it failed. */
    error: text("error"),
    /** Lowercased; the Organization Leader this sync worked `employees.org_depth` out for. */
    orgLeaderEmail: text("org_leader_email"),
  },
  (t) => [
    index("hibob_sync_runs_started_at_idx").on(t.startedAt),
    // One sync at a time: a second insert while one runs is a conflict.
    uniqueIndex("hibob_sync_runs_one_running_idx")
      .on(t.status)
      .where(sql`${t.status} = 'running'`),
  ],
);

export type HibobSyncRun = typeof hibobSyncRuns.$inferSelect;

/**
 * The title lists that sort attendees: a title on the Sales or Engineer list
 * gives that role, and one on the Ignored list keeps its holder off the
 * rosters. A title sits on one list at most, compared case-insensitively.
 */
export const EVALS_TITLE_LISTS = ["sales", "engineer", "ignored"] as const;
export type EvalsTitleList = (typeof EVALS_TITLE_LISTS)[number];

/** An employee's track: a title list's, `exempt`, or `deferred`; see `employees.track` for which wins. */
export const EMPLOYEE_TRACKS = [...EVALS_TITLE_LISTS, "exempt", "deferred"] as const;
export type EmployeeTrack = (typeof EMPLOYEE_TRACKS)[number];

/**
 * A track an administrator set for one person by hand, which outranks every
 * rule and outlives the sync that rebuilds `employees`. A null track keeps
 * them undecided. Keyed by lowercased email, since a sync replaces HiBob ids'
 * rows wholesale.
 */
export const employeeTrackOverrides = pgTable(
  "employee_track_overrides",
  {
    email: text("email").primaryKey(),
    track: text("track").$type<EmployeeTrack>(),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "employee_track_overrides_track_check",
      sql`${t.track} in ('sales', 'engineer', 'ignored', 'exempt', 'deferred')`,
    ),
  ],
);

/**
 * eVals-wide settings with exactly one value each, such as the organization
 * leader whose reports eVals draws attendees from. One row per setting, keyed
 * by name rather than a fixed id so a new setting needs no migration beyond
 * an insert.
 */
export const evalsSettings = pgTable("evals_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const EVALS_SETTINGS_KEYS = {
  orgLeaderEmail: "org_leader_email",
  /** `YYYY-MM-DD`, or empty for no cutoff. See `getCandidateCutoffs`. */
  startDateOnOrAfter: "candidate_start_date_on_or_after",
  activeEffectiveDateAfter: "candidate_active_effective_date_after",
  /** Whole days; see `getDeferralDays`. */
  deferralDays: "deferral_days",
  /** `true` to let the Slack channel sync change Slack; anything else is a dry run. */
  slackSyncLive: "slack_sync_live",
} as const;

/** The deferral window an administrator can set, in whole days; 0 turns deferral off. */
export const DEFERRAL_DAYS_LIMITS = { min: 0, max: 365 } as const;

export const evalsTitles = pgTable(
  "evals_titles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    list: text("list").notNull(),
    title: text("title").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("evals_titles_title_idx").on(sql`lower(${t.title})`)],
);

export const EVALS_TITLE_LIMITS = { title: 200, perRequest: 500 } as const;

export type EvalsTitle = typeof evalsTitles.$inferSelect;

/**
 * People added to the Slack messages sent to each attendee's team at the end
 * of a bootcamp, alongside the attendee's management chain: the Sheet's
 * "Add these email to any slack" Config column. One row per email.
 */
export const evalsSlackContacts = pgTable(
  "evals_slack_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Lowercased. */
    email: text("email").notNull(),
    /** As the employee list had it when they were added or at the last HiBob sync since; empty for someone not in it. */
    fullName: text("full_name").notNull().default(""),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("evals_slack_contacts_email_idx").on(t.email)],
);

export const EVALS_SLACK_CONTACT_LIMITS = { email: 320 } as const;

export type EvalsSlackContact = typeof evalsSlackContacts.$inferSelect;

/**
 * Who has been through bootcamp (BTC) and the intermediate event (INT), and
 * how they scored. One row per email. A date of 2000-01-01 is the sheet's
 * marker for "exempt": someone who never needs to attend.
 */
export const bootcampHistory = pgTable(
  "bootcamp_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Lowercased. */
    email: text("email").notNull(),
    btcDate: date("btc_date", { mode: "string" }),
    intDate: date("int_date", { mode: "string" }),
    /** The overall BTC result, from 1 (poor) to 4 (outstanding), to one decimal place. */
    btcScore: doublePrecision("btc_score"),
    /** The overall INT result, scored the same way. */
    intScore: doublePrecision("int_score"),
    /** Score per exercise, e.g. `{"Score-Exams": 4}`. */
    btcIndividualScores: jsonb("btc_individual_scores").$type<Record<string, number>>(),
    intIndividualScores: jsonb("int_individual_scores").$type<Record<string, number>>(),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("bootcamp_history_email_idx").on(t.email),
    check("bootcamp_history_btc_score_check", sql`${t.btcScore} between 1 and 4`),
    check("bootcamp_history_int_score_check", sql`${t.intScore} between 1 and 4`),
  ],
);

/** The scores a class can give, from poor to outstanding, and the decimal places they are kept to. */
export const BOOTCAMP_SCORE = { min: 1, max: 4, decimals: 1 } as const;

export const EXEMPT_DATE = "2000-01-01";

export const BOOTCAMP_HISTORY_LIMITS = { bytes: 5 * 1024 * 1024, rows: 20_000, email: 320 } as const;

export type BootcampHistory = typeof bootcampHistory.$inferSelect;

/**
 * The Canary Wire's Mindtickle data: one pull of every learner's whole
 * history, which Reporting → Canary Wire slices a month at a time. Only the
 * newest is kept, so saving one deletes the rest — it names ~300 people and
 * who is behind on training, and an old pull answers nothing a new one
 * doesn't. `data` is the `CanaryWireSnapshot` in `lib/canary-wire/snapshot.ts`.
 */
export const canaryWireSnapshots = pgTable("canary_wire_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** When the pull started. Mindtickle's API lags, so the newest completion in it says more about how current it is. */
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  learners: integer("learners").notNull(),
  data: jsonb("data").notNull(),
  savedBy: text("saved_by").references(() => users.id, { onDelete: "set null" }),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
});

export const CANARY_WIRE_PULL_TRIGGERS = ["manual", "schedule"] as const;
export type CanaryWirePullTrigger = (typeof CANARY_WIRE_PULL_TRIGGERS)[number];
export const CANARY_WIRE_PULL_STATUSES = ["running", "succeeded", "failed"] as const;
export type CanaryWirePullStatus = (typeof CANARY_WIRE_PULL_STATUSES)[number];

/**
 * A pull from Mindtickle into `canary_wire_snapshots`. One takes ~15 minutes,
 * longer than a request may run, so it goes in steps (`lib/canary-wire/pull.ts`)
 * that each work for a few minutes and save `state` for the next; a step holds
 * the lease while it runs so two never work at once. `state` names everyone
 * being pulled, so it is cleared when the pull ends either way.
 */
export const canaryWirePulls = pgTable(
  "canary_wire_pulls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trigger: text("trigger").$type<CanaryWirePullTrigger>().notNull(),
    /** Who pressed Refresh; null for a scheduled pull. */
    startedBy: text("started_by").references(() => users.id, { onDelete: "set null" }),
    status: text("status").$type<CanaryWirePullStatus>().notNull().default("running"),
    /** What the pull is doing, as the page shows it. */
    message: text("message").notNull().default(""),
    /** Learners fetched so far, of `total`; 0 of 0 until the rosters are in. */
    done: integer("done").notNull().default(0),
    total: integer("total").notNull().default(0),
    state: jsonb("state"),
    /** Until when a step is working on it; past, any step may take it up. */
    leasedUntil: timestamp("leased_until", { withTimezone: true }),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("canary_wire_pulls_started_at_idx").on(t.startedAt),
    // One pull at a time: a second insert while one runs is a conflict.
    uniqueIndex("canary_wire_pulls_one_running_idx")
      .on(t.status)
      .where(sql`${t.status} = 'running'`),
    check("canary_wire_pulls_trigger_check", sql`${t.trigger} in ('manual', 'schedule')`),
    check("canary_wire_pulls_status_check", sql`${t.status} in ('running', 'succeeded', 'failed')`),
  ],
);

export type CanaryWirePull = typeof canaryWirePulls.$inferSelect;

export const BOOTCAMP_STATUSES = ["scheduled", "active", "complete"] as const;
export type BootcampStatus = (typeof BOOTCAMP_STATUSES)[number];

/**
 * A bootcamp the Scheduler has planned: BTC over `btcDays` from `startDate`,
 * with INT alongside it unless `intDays` is null. `complete` once it has
 * run. At most one is `active`, and its start date is the BTC or INT date that loading its final scores
 * writes to bootcamp history.
 */
export const bootcamps = pgTable(
  "bootcamps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    btcDays: integer("btc_days").notNull(),
    /** Null when this bootcamp holds no intermediate class. */
    intDays: integer("int_days"),
    status: text("status").$type<BootcampStatus>().notNull().default("scheduled"),
    /** Where it is held; its rooms are the ones its sessions can use. */
    facilityId: uuid("facility_id").references((): AnyPgColumn => facilities.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("bootcamps_start_date_idx").on(t.startDate),
    // One active bootcamp: a second while one is active is a conflict.
    uniqueIndex("bootcamps_one_active_idx")
      .on(t.status)
      .where(sql`${t.status} = 'active'`),
    check("bootcamps_status_check", sql`${t.status} in ('scheduled', 'active', 'complete')`),
    check("bootcamps_btc_days_check", sql`${t.btcDays} between 1 and 30`),
    check("bootcamps_int_days_check", sql`${t.intDays} between 1 and 30`),
  ],
);

/** `judges` caps the guest judges one bootcamp's dialog sets at once; it is not a column. */
export const BOOTCAMP_LIMITS = { minDays: 1, maxDays: 30, judges: 50 } as const;
export const BOOTCAMP_DEFAULTS = { btcDays: 4, intDays: 3 } as const;

export type Bootcamp = typeof bootcamps.$inferSelect;

/**
 * Who is added to the active bootcamp's Slack channels beyond its cohort:
 * Bootcamp Contacts to the `sales-` channels, Engineer Contacts to the `se-`
 * ones. One row per email per kind. See `lib/cohorts/slack-sync.ts`.
 */
export const CHANNEL_CONTACT_KINDS = ["sales", "se"] as const;
export type ChannelContactKind = (typeof CHANNEL_CONTACT_KINDS)[number];

export const cohortChannelContacts = pgTable(
  "cohort_channel_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<ChannelContactKind>().notNull(),
    /** Lowercased. */
    email: text("email").notNull(),
    /** As the employee list had it when they were added or at the last HiBob sync since; empty for someone not in it. */
    fullName: text("full_name").notNull().default(""),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("cohort_channel_contacts_kind_email_idx").on(t.kind, t.email),
    check("cohort_channel_contacts_kind_check", sql`${t.kind} in ('sales', 'se')`),
  ],
);

export const CHANNEL_CONTACT_LIMITS = { email: 320 } as const;

/**
 * Each email's Slack user, as `users.lookupByEmail` last answered; a null id
 * is someone Slack has no account for, asked again after a day. Slack ids
 * never change, so one found is not asked again.
 */
export const slackUsers = pgTable("slack_users", {
  /** Lowercased. */
  email: text("email").primaryKey(),
  slackUserId: text("slack_user_id"),
  lookedUpAt: timestamp("looked_up_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** The Slack channel id behind each cohort channel name, found or created once. */
export const slackChannels = pgTable("slack_channels", {
  name: text("name").primaryKey(),
  slackChannelId: text("slack_channel_id").notNull(),
  /** Whether the app created it, rather than finding it already there. */
  created: boolean("created").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The people the channel sync invited, and so the only ones it may remove:
 * someone added by hand, or already in the channel, is never touched. A row
 * goes when the sync removes them or sees they have left.
 */
export const slackChannelMembers = pgTable(
  "slack_channel_members",
  {
    slackChannelId: text("slack_channel_id").notNull(),
    slackUserId: text("slack_user_id").notNull(),
    /** Lowercased; who they were invited as. */
    email: text("email").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.slackChannelId, t.slackUserId] })],
);

export const SLACK_SYNC_TRIGGERS = ["schedule", "manual"] as const;
export type SlackSyncTrigger = (typeof SLACK_SYNC_TRIGGERS)[number];

/** `skipped` is a run with no active bootcamp to sync. */
export const SLACK_SYNC_STATUSES = ["running", "succeeded", "skipped", "failed"] as const;
export type SlackSyncStatus = (typeof SLACK_SYNC_STATUSES)[number];

/** One run of the cohort channel sync and how it ended. */
export const slackSyncRuns = pgTable(
  "slack_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trigger: text("trigger").$type<SlackSyncTrigger>().notNull(),
    /** Who pressed the button; null for a scheduled run. */
    triggeredBy: text("triggered_by").references(() => users.id, {
      onDelete: "set null",
    }),
    status: text("status").$type<SlackSyncStatus>().notNull().default("running"),
    /** A dry run reads Slack and logs what it would do, but changes nothing. */
    dryRun: boolean("dry_run").notNull(),
    bootcampId: uuid("bootcamp_id").references(() => bootcamps.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    invited: integer("invited").notNull().default(0),
    removed: integer("removed").notNull().default(0),
    /** Emails Slack has no account for. */
    notInSlack: integer("not_in_slack").notNull().default(0),
    /** Changes Slack refused. */
    failures: integer("failures").notNull().default(0),
    /** Stopped before its time ran out; the next run picks up where it left off. */
    unfinished: boolean("unfinished").notNull().default(false),
    /** Why it failed, or why it was skipped. */
    error: text("error"),
  },
  (t) => [
    index("slack_sync_runs_started_at_idx").on(t.startedAt),
    // One sync at a time: a second insert while one runs is a conflict.
    uniqueIndex("slack_sync_runs_one_running_idx")
      .on(t.status)
      .where(sql`${t.status} = 'running'`),
    check("slack_sync_runs_trigger_check", sql`${t.trigger} in ('schedule', 'manual')`),
    check(
      "slack_sync_runs_status_check",
      sql`${t.status} in ('running', 'succeeded', 'skipped', 'failed')`,
    ),
  ],
);

export const SLACK_SYNC_ACTIONS = ["created", "joined", "invited", "removed", "not_in_slack", "failed"] as const;
export type SlackSyncAction = (typeof SLACK_SYNC_ACTIONS)[number];

/** What one run did, or in a dry run would have done, to each channel and person. */
export const slackSyncChanges = pgTable(
  "slack_sync_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => slackSyncRuns.id, { onDelete: "cascade" }),
    channelName: text("channel_name").notNull(),
    action: text("action").$type<SlackSyncAction>().notNull(),
    /** Lowercased; empty for a change to the channel itself. */
    email: text("email").notNull().default(""),
    /** Slack's error, for a failure. */
    detail: text("detail"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("slack_sync_changes_run_idx").on(t.runId, t.at)],
);

/**
 * Guest judges for one bootcamp: anyone from the employee list, added in the
 * Scheduler. While that bootcamp is active they can score its attendees on
 * the eVals page, whatever other access they hold.
 */
export const bootcampJudges = pgTable(
  "bootcamp_judges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bootcampId: uuid("bootcamp_id")
      .notNull()
      .references(() => bootcamps.id, { onDelete: "cascade" }),
    /** Lowercased. */
    email: text("email").notNull(),
    /** As the employee list had it when they were added or at the last HiBob sync since. */
    fullName: text("full_name").notNull().default(""),
    addedBy: text("added_by").references(() => users.id, { onDelete: "set null" }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("bootcamp_judges_bootcamp_email_idx").on(t.bootcampId, t.email),
    index("bootcamp_judges_email_idx").on(t.email),
  ],
);

export type BootcampJudge = typeof bootcampJudges.$inferSelect;

/**
 * A place bootcamps are held, set up in Scheduler settings → Facilities. A
 * bootcamp names one, and its sessions pick rooms from it.
 */
export const facilities = pgTable(
  "facilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("facilities_name_idx").on(sql`lower(${t.name})`)],
);

/** One room of a facility, and how many people it holds. Removing it takes it off every session that used it. */
export const facilityRooms = pgTable(
  "facility_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("facility_rooms_name_idx").on(t.facilityId, t.name),
    index("facility_rooms_facility_idx").on(t.facilityId, t.position),
    check("facility_rooms_capacity_check", sql`${t.capacity} between 1 and 10000`),
  ],
);

export const FACILITY_LIMITS = { name: 120, rooms: 100, capacity: 10_000 } as const;

export type Facility = typeof facilities.$inferSelect;
export type FacilityRoom = typeof facilityRooms.$inferSelect;

/**
 * The four parallel schedules of one bootcamp. The SE tracks run on the same
 * days as the class they break out of: `btc_se` beside `btc`, `int_se` beside `int`.
 */
export const SCHEDULE_TRACKS = ["btc", "int", "btc_se", "int_se"] as const;
export type ScheduleTrack = (typeof SCHEDULE_TRACKS)[number];

/**
 * What a session needs, which is all its kind decides:
 *   main          one leader, any number of other instructors, one room
 *   breakout      one leader and other instructors, a room for each of them
 *   unstructured  no one and no room: breaks, lunch, unscheduled time
 */
export const SESSION_KINDS = ["main", "breakout", "unstructured"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

/**
 * Who a session is taught to. A class and its SE track are the same people,
 * so a session for engineers clashes with one beside it for engineers or
 * both, and likewise for sales; see `timeline.ts`.
 */
export const SESSION_AUDIENCES = ["both", "sales", "engineers"] as const;
export type SessionAudience = (typeof SESSION_AUDIENCES)[number];

/** The `employees.track`s each audience is taught to. */
export const AUDIENCE_TRACKS: Record<SessionAudience, readonly ("sales" | "engineer")[]> = {
  both: ["sales", "engineer"],
  sales: ["sales"],
  engineers: ["engineer"],
};

/** The colors a session can be drawn in; `session-style.ts` gives each its classes. */
export const SESSION_COLORS = ["slate", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink"] as const;
export type SessionColor = (typeof SESSION_COLORS)[number];

/**
 * Every day of every track runs from `dayStart` to `dayEnd`, in minutes after
 * midnight, and every session is a whole number of `slot`s long. A session
 * starts where the one before it ends, so these together keep every start on
 * the quarter hour.
 */
export const SCHEDULE_LIMITS = {
  dayStart: 8 * 60,
  dayEnd: 17 * 60,
  /** Nothing may run past midnight. */
  latestEnd: 24 * 60,
  slot: 15,
  maxMinutes: 600,
  sessionsPerDay: 40,
  staff: 12,
  name: 200,
  description: 4000,
  emoji: 16,
  comment: 4000,
  /** The people one comment can tag. */
  mentions: 20,
  types: 50,
  /** The attendees one breakout's groups hold, and the most its class lists for them. */
  groupPeople: 100,
} as const;

/**
 * A quick start for a session: picking one fills in a new session's kind,
 * name, icon, color, length and description, which are then the session's own.
 */
export const sessionTypes = pgTable(
  "session_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: text("kind").$type<SessionKind>().notNull(),
    emoji: text("emoji").notNull().default(""),
    color: text("color").$type<SessionColor>().notNull().default("slate"),
    minutes: integer("minutes").notNull().default(60),
    description: text("description").notNull().default(""),
    position: integer("position").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("session_types_name_idx").on(sql`lower(${t.name})`),
    check("session_types_kind_check", sql`${t.kind} in ('main', 'breakout', 'unstructured')`),
    check("session_types_minutes_check", sql`${t.minutes} between 15 and 600 and ${t.minutes} % 15 = 0`),
  ],
);

export type SessionType = typeof sessionTypes.$inferSelect;

/**
 * One session on one day of one track, from `start` for `minutes`. The
 * sessions of one track-day never overlap; the time between them is
 * unscheduled.
 */
export const scheduleSessions = pgTable(
  "schedule_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bootcampId: uuid("bootcamp_id")
      .notNull()
      .references(() => bootcamps.id, { onDelete: "cascade" }),
    track: text("track").$type<ScheduleTrack>().notNull(),
    /** 1-based; day 1 of every track is the bootcamp's start date. */
    day: integer("day").notNull(),
    /** Minutes after midnight, on the quarter hour. */
    start: integer("start_minute").notNull(),
    minutes: integer("minutes").notNull(),
    kind: text("kind").$type<SessionKind>().notNull(),
    /** Ignored for an unstructured session, which teaches no one. */
    audience: text("audience").$type<SessionAudience>().notNull().default("both"),
    /** The type it was started from, if any; nothing follows from it afterwards. */
    typeId: uuid("type_id").references(() => sessionTypes.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    emoji: text("emoji").notNull().default(""),
    color: text("color").$type<SessionColor>().notNull().default("slate"),
    /** A main session's room. A breakout's rooms are on its staff. */
    roomId: uuid("room_id").references(() => facilityRooms.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("schedule_sessions_day_idx").on(t.bootcampId, t.track, t.day, t.start),
    check("schedule_sessions_track_check", sql`${t.track} in ('btc', 'int', 'btc_se', 'int_se')`),
    check("schedule_sessions_kind_check", sql`${t.kind} in ('main', 'breakout', 'unstructured')`),
    check("schedule_sessions_audience_check", sql`${t.audience} in ('both', 'sales', 'engineers')`),
    check("schedule_sessions_day_check", sql`${t.day} between 1 and 30`),
    check("schedule_sessions_minutes_check", sql`${t.minutes} between 15 and 600 and ${t.minutes} % 15 = 0`),
    check("schedule_sessions_start_check", sql`${t.start} >= 0 and ${t.start} % 15 = 0 and ${t.start} + ${t.minutes} <= 1440`),
  ],
);

export type ScheduleSession = typeof scheduleSessions.$inferSelect;

/**
 * Who runs a session: exactly one leader, and any other instructors. Each is
 * an administrator or a guest judge of the bootcamp when added. In a breakout
 * each has their own room.
 */
export const scheduleSessionStaff = pgTable(
  "schedule_session_staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => scheduleSessions.id, { onDelete: "cascade" }),
    /** Lowercased. */
    email: text("email").notNull(),
    fullName: text("full_name").notNull().default(""),
    leader: boolean("leader").notNull().default(false),
    roomId: uuid("room_id").references(() => facilityRooms.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    uniqueIndex("schedule_session_staff_email_idx").on(t.sessionId, t.email),
    uniqueIndex("schedule_session_staff_leader_idx")
      .on(t.sessionId)
      .where(sql`${t.leader}`),
  ],
);

/**
 * Who goes with whom in a breakout: each attendee taught it, by email, and
 * the instructor whose room they go to to be evaluated. An attendee is in one
 * group at most; one in none is not yet assigned. Only a breakout keeps any,
 * and only with instructors still on its staff.
 */
export const scheduleSessionGroups = pgTable(
  "schedule_session_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => scheduleSessions.id, { onDelete: "cascade" }),
    /** Lowercased. */
    email: text("email").notNull(),
    /** As the employee list had it when they were assigned or at the last HiBob sync since. */
    fullName: text("full_name").notNull().default(""),
    /** Lowercased; one of the session's staff. */
    instructorEmail: text("instructor_email").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("schedule_session_groups_email_idx").on(t.sessionId, t.email)],
);

/** A note on a session, kept with who wrote it and when. */
export const scheduleSessionComments = pgTable(
  "schedule_session_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => scheduleSessions.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    /** Copied in, so the comment still says who wrote it after their account is gone. */
    authorName: text("author_name").notNull().default(""),
    authorEmail: text("author_email").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("schedule_session_comments_session_idx").on(t.sessionId, t.createdAt)],
);

/** Every track keeps a checklist per day, the SE tracks their own. */
export const CHECKLIST_TRACKS = SCHEDULE_TRACKS;
export type ChecklistTrack = ScheduleTrack;

/** `itemsPerDay` caps one track-day's checklist, so it is read whole. */
export const CHECKLIST_LIMITS = { name: 200, itemsPerDay: 100 } as const;

/** The Prep Day checklist, for before the bootcamp starts: day 0 of Bootcamp, the only track with a day 0. */
export const CHECKLIST_PREP_DAY = { track: "btc", day: 0 } as const;

/**
 * Something to do before one day of one track starts, or on Bootcamp's day 0
 * before the bootcamp does (`CHECKLIST_PREP_DAY`). Its owner, if any, is
 * an administrator or guest judge of the bootcamp, kept by email; who wrote
 * it and who ticked it are copied in, so they outlast the accounts.
 */
export const scheduleChecklistItems = pgTable(
  "schedule_checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bootcampId: uuid("bootcamp_id")
      .notNull()
      .references(() => bootcamps.id, { onDelete: "cascade" }),
    track: text("track").$type<ChecklistTrack>().notNull(),
    /** 1-based, as a schedule session's; 0 is Bootcamp's Prep Day. */
    day: integer("day").notNull(),
    name: text("name").notNull(),
    /** Lowercased; null when nobody owns it. */
    ownerEmail: text("owner_email"),
    ownerName: text("owner_name").notNull().default(""),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneBy: text("done_by").references(() => users.id, { onDelete: "set null" }),
    doneByName: text("done_by_name").notNull().default(""),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull().default(""),
    createdByEmail: text("created_by_email").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("schedule_checklist_items_day_idx").on(t.bootcampId, t.track, t.day, t.createdAt),
    index("schedule_checklist_items_owner_idx").on(t.ownerEmail),
    check("schedule_checklist_items_track_check", sql`${t.track} in ('btc', 'int', 'btc_se', 'int_se')`),
    check("schedule_checklist_items_day_check", sql`${t.day} between 0 and 30 and (${t.day} > 0 or ${t.track} = 'btc')`),
  ],
);

export type ScheduleChecklistItem = typeof scheduleChecklistItems.$inferSelect;

/** The class an assessment scores, as a bootcamp holds them. */
export const EVALS_ASSESSMENT_STAGES = ["bootcamp", "intermediate"] as const;
export type EvalsAssessmentStage = (typeof EVALS_ASSESSMENT_STAGES)[number];

/** Who an assessment scores: one track, or both. */
export const EVALS_ASSESSMENT_AUDIENCES = ["sales", "engineer", "both"] as const;
export type EvalsAssessmentAudience = (typeof EVALS_ASSESSMENT_AUDIENCES)[number];

/**
 * Something attendees are scored on during a bootcamp, defined in eVals
 * Settings → Assessments. Its criteria are rows of their own, so an
 * assessment can gain or lose one without a column changing anywhere.
 */
export const evalsAssessments = pgTable(
  "evals_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    stage: text("stage").$type<EvalsAssessmentStage>().notNull(),
    audience: text("audience").$type<EvalsAssessmentAudience>().notNull(),
    /** Inactive assessments are kept, with their scores, but not offered for scoring. */
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("evals_assessments_stage_idx").on(t.stage, t.active),
    check("evals_assessments_stage_check", sql`${t.stage} in ('bootcamp', 'intermediate')`),
    check("evals_assessments_audience_check", sql`${t.audience} in ('sales', 'engineer', 'both')`),
  ],
);

export type EvalsAssessment = typeof evalsAssessments.$inferSelect;

/**
 * One thing an assessment scores from 1 to 4. A criterion that has been
 * scored is retired rather than deleted, so the scores given against it keep
 * pointing somewhere; a retired criterion is no longer asked.
 */
export const evalsAssessmentCriteria = pgTable(
  "evals_assessment_criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => evalsAssessments.id, { onDelete: "cascade" }),
    /** Order on the form, from 0. */
    position: integer("position").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("evals_assessment_criteria_assessment_idx").on(t.assessmentId, t.position)],
);

export type EvalsAssessmentCriterion = typeof evalsAssessmentCriteria.$inferSelect;

export const EVALS_ASSESSMENT_LIMITS = {
  name: 200,
  criterionName: 200,
  description: 2000,
  criteria: 50,
  comment: 4000,
  feedback: 8000,
} as const;

/**
 * The one assessment of one attendee at one bootcamp. Anyone who can score
 * may revise it; whoever saved it last owns it. The assessment's name and
 * each criterion's are copied in, so renaming either later leaves what was
 * scored readable.
 */
export const evalsSubmissions = pgTable(
  "evals_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Restrict: removing a bootcamp would take its scores with it.
    bootcampId: uuid("bootcamp_id")
      .notNull()
      .references(() => bootcamps.id, { onDelete: "restrict" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => evalsAssessments.id, { onDelete: "restrict" }),
    /** The attendee, lowercased. */
    attendeeEmail: text("attendee_email").notNull(),
    assessmentName: text("assessment_name").notNull(),
    /** The mean of the criterion scores, to one decimal place. */
    averageScore: doublePrecision("average_score").notNull(),
    positiveFeedback: text("positive_feedback").notNull().default(""),
    constructiveFeedback: text("constructive_feedback").notNull().default(""),
    /** Whoever saved it last. */
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Also the version a revision must name, so two judges cannot silently overwrite each other. */
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("evals_submissions_one_idx").on(t.bootcampId, t.assessmentId, t.attendeeEmail),
    index("evals_submissions_assessment_idx").on(t.assessmentId),
    check("evals_submissions_average_check", sql`${t.averageScore} between 1 and 4`),
  ],
);

export type EvalsSubmission = typeof evalsSubmissions.$inferSelect;

/** One criterion's score in a submission. */
export const evalsSubmissionScores = pgTable(
  "evals_submission_scores",
  {
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => evalsSubmissions.id, { onDelete: "cascade" }),
    // Restrict: a scored criterion is retired, never deleted.
    criterionId: uuid("criterion_id")
      .notNull()
      .references(() => evalsAssessmentCriteria.id, { onDelete: "restrict" }),
    criterionName: text("criterion_name").notNull(),
    score: integer("score").notNull(),
    comment: text("comment").notNull().default(""),
  },
  (t) => [
    primaryKey({ columns: [t.submissionId, t.criterionId] }),
    index("evals_submission_scores_criterion_idx").on(t.criterionId),
    check("evals_submission_scores_score_check", sql`${t.score} between 1 and 4`),
  ],
);

export type EvalsSubmissionScore = typeof evalsSubmissionScores.$inferSelect;

/**
 * The transcript of one recording a judge made while scoring an attendee,
 * filed as their submission is — by bootcamp, assessment and attendee — so it
 * is kept whether or not the scores are saved yet, and stays with them after.
 * The audio itself never leaves the judge's browser; only this text does.
 */
export const evalsTranscripts = pgTable(
  "evals_transcripts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Restrict, as for submissions: removing either would take the transcripts with it.
    bootcampId: uuid("bootcamp_id")
      .notNull()
      .references(() => bootcamps.id, { onDelete: "restrict" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => evalsAssessments.id, { onDelete: "restrict" }),
    /** The attendee, lowercased. */
    attendeeEmail: text("attendee_email").notNull(),
    /** The recording's id in the judge's browser; sending it again returns this row rather than a second. */
    recordingId: uuid("recording_id").notNull(),
    recordedById: text("recorded_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Copied in, so the transcript still says who recorded it after they leave. */
    recordedByName: text("recorded_by_name").notNull().default(""),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    /** Deepgram's transcript of the whole recording, paragraphs split by blank lines. */
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("evals_transcripts_recording_idx").on(t.recordingId),
    index("evals_transcripts_attendee_idx").on(t.bootcampId, t.assessmentId, t.attendeeEmail, t.recordedAt),
    index("evals_transcripts_assessment_idx").on(t.assessmentId),
  ],
);

export type EvalsTranscript = typeof evalsTranscripts.$inferSelect;

/** What an "@" tag is in: a session comment, a checklist item, or the comment on one criterion of an eVals submission. */
export const MENTION_KINDS = ["comment", "checklist", "score"] as const;
export type MentionKind = (typeof MENTION_KINDS)[number];

/**
 * Someone tagged with "@", kept by email since a guest judge may have no
 * account, and listed on that person's inbox. Exactly one of `commentId`,
 * `checklistItemId` and `submissionId` is set. A score comment's tag names
 * the submission and the criterion rather than the score row, because a
 * revision replaces the scores; the save keeps the tags still in the text
 * and drops the rest. Who tagged and when are copied in for the same reason:
 * whoever saves an eVals submission last owns it.
 */
export const mentions = pgTable(
  "mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commentId: uuid("comment_id").references(() => scheduleSessionComments.id, { onDelete: "cascade" }),
    checklistItemId: uuid("checklist_item_id").references(() => scheduleChecklistItems.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id").references(() => evalsSubmissions.id, { onDelete: "cascade" }),
    criterionId: uuid("criterion_id").references(() => evalsAssessmentCriteria.id, { onDelete: "cascade" }),
    /** The bootcamp whose people could be tagged, and whose page it links to. */
    bootcampId: uuid("bootcamp_id")
      .notNull()
      .references(() => bootcamps.id, { onDelete: "cascade" }),
    /** Lowercased. */
    email: text("email").notNull(),
    /** As the list of who could be tagged had it; the text spells it after an "@". */
    fullName: text("full_name").notNull().default(""),
    taggedBy: text("tagged_by").references(() => users.id, { onDelete: "set null" }),
    taggedByName: text("tagged_by_name").notNull().default(""),
    taggedByEmail: text("tagged_by_email").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mentions_comment_email_idx").on(t.commentId, t.email),
    uniqueIndex("mentions_checklist_item_email_idx").on(t.checklistItemId, t.email),
    uniqueIndex("mentions_score_email_idx").on(t.submissionId, t.criterionId, t.email),
    index("mentions_email_idx").on(t.email),
    check(
      "mentions_one_source_check",
      sql`num_nonnulls(${t.commentId}, ${t.checklistItemId}, ${t.submissionId}) = 1 and (${t.submissionId} is null) = (${t.criterionId} is null)`,
    ),
  ],
);

/**
 * How an audited action reached the app: a signed-in browser, a personal
 * access token, the app itself (the runner, Cloud Scheduler, Auth.js), or
 * someone with no account (an attendee claiming a workshop login).
 */
export const AUDIT_VIA = ["session", "token", "system", "anonymous"] as const;
export type AuditVia = (typeof AUDIT_VIA)[number];
export const auditVia = pgEnum("audit_via", AUDIT_VIA);

/** Whether it worked: refused at the gate (403), or tried and failed (any other 4xx/5xx). */
export const AUDIT_OUTCOMES = ["succeeded", "denied", "failed"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
export const auditOutcome = pgEnum("audit_outcome", AUDIT_OUTCOMES);

/**
 * One action anyone or anything took: every change made through the API, a
 * sign-in or sign-out, a saved preference, and what the runner did to a
 * workshop. Written by `src/lib/audit.ts` (and `runner/src/db.ts`), never
 * updated, and kept when the actor's account is deleted — the name and email
 * are copied in for that reason.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name"),
    actorEmail: text("actor_email"),
    via: auditVia("via").notNull(),
    /** "PATCH /api/users/{id}" for a route; "auth.sign-in", "runner.provisioned" and the like otherwise. */
    action: text("action").notNull(),
    /** What the action does, in words — the API reference's summary for a route. */
    summary: text("summary").notNull(),
    /** The URL actually requested, for a route. */
    path: text("path"),
    /** The id the action was aimed at, if any. */
    target: text("target"),
    /** A readable name for it, where the action knew one. */
    targetLabel: text("target_label"),
    status: integer("status"),
    outcome: auditOutcome("outcome").notNull(),
    /** The request body with secrets redacted, the error code, and anything the action added. */
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    ip: text("ip"),
  },
  (t) => [
    index("audit_events_at_idx").on(t.at),
    index("audit_events_actor_idx").on(t.actorId, t.at),
    index("audit_events_action_idx").on(t.action, t.at),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;

export type WorkshopRun = typeof workshopRuns.$inferSelect;
export type LabGuide = typeof labGuides.$inferSelect;
export type LabWorkshop = typeof labWorkshops.$inferSelect;
export type LabImage = typeof labImages.$inferSelect;
export type WorkshopAccount = typeof workshopAccounts.$inferSelect;
export type RunLog = typeof runLogs.$inferSelect;
export type RunResource = typeof runResources.$inferSelect;
export type RunStatus = (typeof runStatus.enumValues)[number];
