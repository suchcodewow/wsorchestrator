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
  customType,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const themePreference = pgEnum("theme_preference", THEME_PREFERENCES);

export const SITE_ROLES = [
  "contributor",
  "operator",
  "manager",
  "administrator",
] as const;
export type SiteRole = (typeof SITE_ROLES)[number];

export const siteRole = pgEnum("site_role", SITE_ROLES);

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
  siteRole: siteRole("site_role").notNull().default("operator"),
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
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("api_tokens_user_idx").on(t.userId, t.createdAt)],
);

export const TOKEN_TTL_DAYS = 30;

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

export type WorkshopRun = typeof workshopRuns.$inferSelect;
export type LabGuide = typeof labGuides.$inferSelect;
export type LabWorkshop = typeof labWorkshops.$inferSelect;
export type LabImage = typeof labImages.$inferSelect;
export type WorkshopAccount = typeof workshopAccounts.$inferSelect;
export type RunLog = typeof runLogs.$inferSelect;
export type RunResource = typeof runResources.$inferSelect;
export type RunStatus = (typeof runStatus.enumValues)[number];
