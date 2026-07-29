import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  uuid,
  bigserial,
  primaryKey,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

/* ------------------------------------------------------------------ *
 * Auth.js (NextAuth) tables — shape required by @auth/drizzle-adapter
 * ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
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

/* ------------------------------------------------------------------ *
 * Domain tables — workshops, their attendee accounts, streamed logs
 * ------------------------------------------------------------------ */

export const runStatus = pgEnum("run_status", [
  "requested",
  "provisioning", // create the Workspace OU and its attendee accounts
  "applying", // terraform apply of the per-cloud resources
  "ready", // outputs available; expires_at set
  "destroying", // reaper tearing down clouds, accounts, and the OU
  "destroyed",
  "failed",
  "scheduled", // created on the calendar, awaiting its start time
]);

/** Clouds a workshop can ask for. Only `gcp` is wired up so far. */
export const CLOUDS = ["aws", "azure", "gcp"] as const;
export type Cloud = (typeof CLOUDS)[number];

export const CLOUD_LABELS: Record<Cloud, string> = {
  aws: "Amazon Web Services",
  azure: "Azure",
  gcp: "Google Cloud Platform",
};

/** Maximum attendees a single workshop may provision. */
export const MAX_USERS = 50;

/**
 * Whether a run's configuration can still be changed. Pure, so both the API
 * and the client form can agree on it.
 *
 * `scheduled` — nothing exists yet, so anything goes.
 * `ready` — accounts and cloud environments are live, so the config may only
 *   grow; shrinking would mean deleting accounts that are already in use.
 * Anything else is mid-flight or finished, and is left alone.
 */
export function editabilityOf(status: RunStatus): "full" | "grow" | "locked" {
  if (status === "scheduled") return "full";
  if (status === "ready") return "grow";
  return "locked";
}

/**
 * A scheduled workshop. Self-describing — the attendee count and the set of
 * clouds are captured here, so there is no separate template to select.
 */
export const workshopRuns = pgTable(
  "workshop_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** User-given name; the OU, account, and project names derive from it. */
    name: text("name").notNull(),
    /** Slugified `name`, used to build account and project identifiers. */
    slug: text("slug").notNull(),
    /** How many attendee accounts to create (1..MAX_USERS). */
    userCount: integer("user_count").notNull(),
    /** Which clouds to provision; subset of CLOUDS. */
    clouds: text("clouds").array().$type<Cloud[]>().notNull().default([]),
    status: runStatus("status").notNull().default("scheduled"),
    /** When the workshop should auto-provision (set from the calendar). */
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
    /** Google Workspace OU created for this workshop, e.g. /Workshops/Foo. */
    orgUnitPath: text("org_unit_path"),
    /** ws-<slug>-<short>; set while provisioning GCP. */
    gcpProjectId: text("gcp_project_id"),
    /** GCS state prefix: workshops/<run-id>. */
    statePrefix: text("state_prefix").notNull(),
    /** Terraform outputs surfaced in the UI (project id, URLs, ...). */
    outputs: jsonb("outputs"),
    error: text("error"),
    /** Time-to-live before auto-destroy. Defaults to 1 hour for testing. */
    ttlSeconds: integer("ttl_seconds").notNull().default(3600),
    /** Set when status -> ready; the reaper destroys runs past this. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    destroyedAt: timestamp("destroyed_at", { withTimezone: true }),
  },
  (t) => [
    index("workshop_runs_reaper_idx").on(t.status, t.expiresAt),
    index("workshop_runs_user_idx").on(t.userId, t.createdAt),
    // scheduler: find scheduled runs whose start time has arrived
    index("workshop_runs_scheduler_idx").on(t.status, t.scheduledStart),
  ],
);

/**
 * One Google Workspace account created for a workshop attendee. The temporary
 * password is stored so the organizer can hand it out; it is force-rotated at
 * first sign-in and the account is deleted when the workshop is reaped.
 */
export const workshopAccounts = pgTable(
  "workshop_accounts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workshopRuns.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /** Temporary password; `changePasswordAtNextLogin` is set on the account. */
    tempPassword: text("temp_password").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("workshop_accounts_run_idx").on(t.runId, t.id)],
);

/** Streamed build output rendered live in the run detail view. */
export const runLogs = pgTable(
  "run_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workshopRuns.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    stream: text("stream").notNull(), // 'stdout' | 'stderr' | 'system'
    message: text("message").notNull(),
  },
  (t) => [index("run_logs_run_idx").on(t.runId, t.id)],
);

export type WorkshopRun = typeof workshopRuns.$inferSelect;
export type WorkshopAccount = typeof workshopAccounts.$inferSelect;
export type RunLog = typeof runLogs.$inferSelect;
export type RunStatus = (typeof runStatus.enumValues)[number];
