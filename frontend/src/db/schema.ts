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
  customType,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

/**
 * Postgres `bytea`, which Drizzle has no built-in column for. `pg` hands these
 * back as a Node `Buffer` and takes one on the way in, so the mapping is the
 * identity in both directions.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/* ------------------------------------------------------------------ *
 * Auth.js (NextAuth) tables — shape required by @auth/drizzle-adapter
 * ------------------------------------------------------------------ */

/**
 * Colour scheme the user picked. `system` follows the OS setting and can only
 * be resolved in the browser, so it is stored as-is rather than as a resolved
 * light/dark. New users get it by default.
 */
export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const themePreference = pgEnum("theme_preference", THEME_PREFERENCES);

/**
 * What a signed-in user may do across the site, least privileged first.
 *
 * The order is the hierarchy — `roleAtLeast` in `@/lib/roles` compares by
 * index — so roles must only ever be appended in ascending power. Everyone
 * starts an `operator`; the rest are granted by an administrator (or, for the
 * first one, by `SITE_ADMIN_EMAILS`; see `@/auth`).
 */
export const SITE_ROLES = ["operator", "manager", "administrator"] as const;
export type SiteRole = (typeof SITE_ROLES)[number];

export const siteRole = pgEnum("site_role", SITE_ROLES);

/**
 * Whose events the calendar shows. Only meaningful for a manager or above —
 * an operator's calendar is always their own — but it is stored for everyone
 * so that a demotion and a later re-promotion don't lose the choice.
 */
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

/**
 * What kind of event a run is. Both provision Workspace accounts and a Harness
 * org the same way; they differ in how many users are allowed, whether more
 * than one cloud may be picked, and how GCP is laid out (see `EVENT_LIMITS`).
 */
export const EVENT_MODES = ["workshop", "challenge"] as const;
export type EventMode = (typeof EVENT_MODES)[number];

export const eventMode = pgEnum("event_mode", EVENT_MODES);

/** Maximum attendees a single workshop may provision. */
export const MAX_USERS = 50;

/**
 * Per-mode configuration rules, shared by the create form, the edit form, and
 * both API routes so they cannot drift apart.
 *
 * A challenge is a small head-to-head event: few competitors, a single cloud,
 * and — on GCP — a project each rather than one shared project.
 */
export const EVENT_LIMITS: Record<
  EventMode,
  { maxUsers: number; defaultUsers: number; minClouds: number; maxClouds: number }
> = {
  // A workshop may pick no cloud at all — that grants attendees the shared
  // long-lived testing project instead of provisioning a throwaway one. A
  // challenge is head-to-head on exactly one cloud, so it still requires one.
  workshop: {
    maxUsers: MAX_USERS,
    defaultUsers: 10,
    minClouds: 0,
    maxClouds: CLOUDS.length,
  },
  challenge: { maxUsers: 5, defaultUsers: 1, minClouds: 1, maxClouds: 1 },
};

export const limitsFor = (mode: EventMode) => EVENT_LIMITS[mode];

/** Seconds in a day. TTLs are stored in seconds but chosen in whole days. */
export const DAY_SECONDS = 24 * 60 * 60;

/**
 * How long an event lives before the reaper tears it down, chosen in days on
 * the create form. The default is one day; three is the ceiling. An event that
 * needs longer is extended one day at a time from its own page — see
 * `EXTENSION_SECONDS` and `extendRun`.
 */
export const DEFAULT_TTL_DAYS = 1;
export const MAX_TTL_DAYS = 3;

/** One click of "Extend" on an event's page buys it this much more time. */
export const EXTENSION_SECONDS = DAY_SECONDS;

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
    /** Workshop (shared project) or challenge (a project per competitor). */
    mode: eventMode("mode").notNull().default("workshop"),
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
    /**
     * ws-<slug>-<short>; set while provisioning GCP. Only meaningful for a
     * workshop — a challenge's per-competitor project ids live in `outputs`.
     */
    gcpProjectId: text("gcp_project_id"),
    /** GCS state prefix: workshops/<run-id>. */
    statePrefix: text("state_prefix").notNull(),
    /** Terraform outputs surfaced in the UI (project id, URLs, ...). */
    outputs: jsonb("outputs"),
    error: text("error"),
    /**
     * Time-to-live before auto-destroy, in seconds. Chosen in whole days on
     * the create form (1–{@link MAX_TTL_DAYS}); the default is one day. An
     * event can buy more time a day at a time via "Extend" on its page.
     */
    ttlSeconds: integer("ttl_seconds")
      .notNull()
      .default(DEFAULT_TTL_DAYS * DAY_SECONDS),
    /**
     * Somebody asked for this run to be deleted while it still held live
     * resources. The row has to outlive the request — the reaper needs it to
     * find what to tear down — so the delete is recorded here and carried out
     * by the reaper once teardown finishes. See `deleteRun` in `@/lib/runs`.
     */
    deleteRequested: boolean("delete_requested").notNull().default(false),
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

/** Longest a claim answer may be, per field. Shared by the form and the API. */
export const CLAIM_LIMITS = { name: 80, from: 80, vacation: 120 } as const;

/**
 * One Google Workspace account created for a workshop attendee. The temporary
 * password is stored so the organizer can hand it out; it is force-rotated at
 * first sign-in and the account is deleted when the workshop is reaped.
 *
 * The `claimed*` columns are filled in by the attendee themselves on the shared
 * event page — they are how the room decides who is using which account, and
 * double as an icebreaker. Nobody is signed in when they are written, so they
 * are free text and are never used to authorize anything.
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
    /** Who took this account. Null means the row is still up for grabs. */
    claimedName: text("claimed_name"),
    /** Where they are from. */
    claimedFrom: text("claimed_from"),
    /** Favourite vacation. */
    claimedVacation: text("claimed_vacation"),
    /** Set atomically with the answers; the marker that a row is taken. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
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

/* ------------------------------------------------------------------ *
 * Lab guides — the public, standalone teaching material
 * ------------------------------------------------------------------ */

/**
 * A lab guide: the written instructions an attendee follows during a session.
 *
 * Deliberately *not* attached to `workshopRuns`. A run is one Tuesday afternoon
 * and is reaped an hour later; a guide is the material itself, written once and
 * followed by every room that ever takes that lab. Tying the two together would
 * mean the guide disappeared with the environment it described.
 *
 * Guides are world-readable by design — the room follows them without signing
 * in, the same way `/attend` works — so nothing sensitive belongs in `body`.
 * Writing them takes a manager (see `canManageLabGuides` in `@/lib/roles`).
 *
 * There is no `published` here on purpose. Publishing is a decision about a
 * *workshop* — the thing a room is pointed at — and a guide carrying its own
 * copy of that flag only ever meant a lab could vanish out of the middle of a
 * workshop that had itself been published. See `labWorkshops.published`.
 */
export const labGuides = pgTable(
  "lab_guides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** URL identity: /labs/guides/<slug>. Follows the title when it changes. */
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    /** One-line description; the only body text the index page shows. */
    summary: text("summary").notNull().default(""),
    /** The guide itself, as GitHub-flavoured Markdown. */
    body: text("body").notNull().default(""),
    /** Who wrote it. Kept when they are deleted — the guide outlives the account. */
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
  // The library's query: every guide, most recently updated first.
  (t) => [index("lab_guides_updated_at_idx").on(t.updatedAt)],
);

/** Longest a guide's fields may be. Shared by the form and the API. */
export const LAB_GUIDE_LIMITS = {
  title: 200,
  summary: 300,
  /** Generous — a full lab with code blocks, but not an upload channel. */
  body: 200_000,
} as const;

/**
 * An ordered collection of lab guides — the curriculum a room works through.
 *
 * Named `lab_workshops`, not `workshops`, and the distance from `workshopRuns`
 * above is the whole reason. A run is one afternoon of provisioned accounts and
 * cloud projects that the reaper deletes an hour later; this is the teaching
 * material, which outlives every room that follows it. The two are not related
 * rows and there is no foreign key between them, so they should not read like
 * two halves of one thing.
 */
export const labWorkshops = pgTable(
  "lab_workshops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** URL identity: /labs/<slug>. Stable across title edits once published. */
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    /** One-line description, shown on the list of workshops. */
    summary: text("summary").notNull().default(""),
    /**
     * The one publishing decision there is. A draft workshop, and everything
     * reachable *through* it, is visible only to the managers who can edit it,
     * so a half-built curriculum isn't served to a room that wandered in early.
     */
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

/**
 * Which guides a workshop is made of, and in what order.
 *
 * Many-to-many on purpose: "Authenticate to Google Cloud" is the same lab
 * whether it opens the onboarding workshop or the security one, and writing it
 * twice means fixing it twice. The composite primary key also settles a
 * question the UI would otherwise have to: a guide appears in a workshop at
 * most once.
 *
 * `position` is rewritten wholesale on every save rather than patched, so the
 * stored order is always a clean 0..n-1 with no gaps to reason about.
 */
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
    // "which workshops use this guide?" — asked when one is about to be deleted
    index("lab_workshop_guides_guide_idx").on(t.guideId),
  ],
);

/** Longest a workshop's fields may be. Shared by the form and the API. */
export const LAB_WORKSHOP_LIMITS = {
  title: 200,
  summary: 300,
  /** More than a room can work through in a day; a guard, not a target. */
  guides: 50,
} as const;

/**
 * An image a lab guide can show — a screenshot of a console, a diagram.
 *
 * The bytes live in the database rather than on disk or in a bucket, and the
 * reason is the deployment: the app runs on Cloud Run, where the filesystem is
 * per-instance and thrown away on the next revision. Postgres is the only
 * durable store already wired up, which also means images are covered by the
 * same backups as the guides that reference them — an image and the guide
 * pointing at it are restored together or not at all.
 *
 * The trade is that image bytes sit in the database and in every backup, so
 * `LAB_IMAGE_LIMITS.bytes` is the thing keeping this honest.
 *
 * Not joined to `labGuides`. An image is referenced by URL from inside Markdown
 * that any number of guides may hold, and there is no way to know from the
 * bytes which guides mention them — so this is a library, like the guides
 * themselves are a library to the workshops.
 */
export const labImages = pgTable(
  "lab_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** What an author searches for. Not unique — two "console" is their call. */
    name: text("name").notNull(),
    /** Default alt text, offered when the image is inserted. */
    alt: text("alt").notNull().default(""),
    /** Validated against `LAB_IMAGE_MIME_TYPES` before the row is written. */
    mimeType: text("mime_type").notNull(),
    /** Length of `data`, kept alongside so the picker needn't read the bytes. */
    bytes: integer("bytes").notNull(),
    data: bytea("data").notNull(),
    /** Who uploaded it. Kept when they are deleted — the image outlives them. */
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // The picker's query: newest first, and a name search on top of it.
  (t) => [index("lab_images_created_at_idx").on(t.createdAt)],
);

/**
 * What may be uploaded.
 *
 * SVG is absent deliberately. It is a document, not a bitmap — it can carry
 * script and external references — and these are served from the app's own
 * origin onto a public page, so an SVG upload would be a stored-XSS hole with
 * an upload form attached to it.
 */
export const LAB_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export const LAB_IMAGE_LIMITS = {
  name: 200,
  alt: 300,
  /** Per image. Generous for a screenshot, small enough to keep out of trouble. */
  bytes: 5 * 1024 * 1024,
} as const;

export type WorkshopRun = typeof workshopRuns.$inferSelect;
export type LabGuide = typeof labGuides.$inferSelect;
export type LabWorkshop = typeof labWorkshops.$inferSelect;
export type LabImage = typeof labImages.$inferSelect;
export type WorkshopAccount = typeof workshopAccounts.$inferSelect;
export type RunLog = typeof runLogs.$inferSelect;
export type RunStatus = (typeof runStatus.enumValues)[number];
