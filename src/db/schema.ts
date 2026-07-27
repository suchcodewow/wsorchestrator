import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
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
 * Domain tables — workshop library, runs, streamed logs
 * ------------------------------------------------------------------ */

export const runStatus = pgEnum("run_status", [
  "requested",
  "provisioning", // create project, link billing, enable APIs
  "applying", // terraform apply of workshop resources
  "ready", // outputs available; expires_at set
  "destroying", // reaper running terraform destroy + project delete
  "destroyed",
  "failed",
  "scheduled", // created on the calendar, awaiting its start time
]);

/** The library of workshops a user can pick from. */
export const workshops = pgTable("workshops", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  icon: text("icon"), // lucide icon name or asset ref
  /** Where the Terraform lives: git repo/ref or a module path in the runner image. */
  tfSource: text("tf_source").notNull(),
  /** Variable schema/defaults passed to Terraform for this workshop. */
  variables: jsonb("variables").notNull().default({}),
  /** Time-to-live before auto-destroy. Defaults to 1 hour for testing. */
  ttlSeconds: integer("ttl_seconds").notNull().default(3600),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** A single provisioning run of a workshop for a user. */
export const workshopRuns = pgTable(
  "workshop_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workshopId: uuid("workshop_id")
      .notNull()
      .references(() => workshops.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** User-given name for this scheduled workshop instance. */
    name: text("name"),
    status: runStatus("status").notNull().default("scheduled"),
    /** When the workshop should auto-provision (set from the calendar). */
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
    /** ws-<slug>-<short>; set during provisioning. */
    gcpProjectId: text("gcp_project_id"),
    /** GCS state prefix: workshops/<workshop-id>/<run-id>. */
    statePrefix: text("state_prefix").notNull(),
    /** Terraform outputs surfaced in the UI (URLs, cluster name, ...). */
    outputs: jsonb("outputs"),
    error: text("error"),
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

export type Workshop = typeof workshops.$inferSelect;
export type WorkshopRun = typeof workshopRuns.$inferSelect;
export type RunLog = typeof runLogs.$inferSelect;
export type RunStatus = (typeof runStatus.enumValues)[number];
