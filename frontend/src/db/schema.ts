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
 * index — so the list must stay sorted from least to most privileged. Nothing
 * compares against a literal index, so a role may be inserted as well as
 * appended, which is how `contributor` arrived beneath `operator`.
 *
 * Everyone starts an `operator`; the rest are granted by an administrator (or,
 * for the first one, by `SITE_ADMIN_EMAILS`; see `@/auth`). `contributor` is
 * the one role below that default, and it is deliberately not something anyone
 * becomes by signing in: it is for people outside the team who write Harness
 * components and test them in a sandbox, and it grants nothing else.
 */
export const SITE_ROLES = [
  "contributor",
  "operator",
  "manager",
  "administrator",
] as const;
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
    /**
     * Build the Harness organization and the component catalog, and stop —
     * no Terraform, no cloud project, no cluster.
     *
     * This is what makes contributing components affordable. Testing a new
     * connector or template means applying it to a real org and exercising it,
     * and a full run builds a GCP project and a GKE cluster to get there, which
     * is minutes and real money for something that never touches either. A
     * component that genuinely needs a cloud credential simply stays pending —
     * `applyCatalog` reports it, which is a truthful answer rather than a
     * silent pass, and the reviewer can run the full thing.
     */
    harnessOnly: boolean("harness_only").notNull().default(false),
    /**
     * The candidate set this run deploys on top of the published baseline, if
     * any. Its presence is what makes a run a test of somebody's proposed
     * components rather than a deployment of the current ones.
     */
    componentSetId: uuid("component_set_id").references(
      (): AnyPgColumn => harnessComponentSets.id,
      { onDelete: "set null" },
    ),
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
    /**
     * Entra Temporary Access Pass, for workshops that provisioned Azure.
     *
     * The credential an attendee actually signs into the Azure portal with:
     * Microsoft enforces MFA there tenant-wide, and a pass satisfies it without
     * an authenticator app. Null for a run with no Azure environment, and for
     * one whose tenant has the pass method switched off.
     */
    azureAccessPass: text("azure_access_pass"),
    /** When the pass stops working. Sized to outlast the workshop. */
    azureAccessPassExpiresAt: timestamp("azure_access_pass_expires_at", {
      withTimezone: true,
    }),
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

/**
 * Kinds of thing a run builds, in the order a build tends to confirm them.
 *
 * Stored as plain text rather than a Postgres enum: the runner is what writes
 * these, and a new kind of resource should be shippable from there without a
 * migration on this side. The UI keeps a label and an icon per known kind and
 * falls back to the stored label for anything it does not recognise yet.
 */
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
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/**
 * One thing a run has actually built, written by the runner the moment the
 * provider confirms it.
 *
 * This is the answer to "what exists so far?", which neither of the two things
 * that used to be asked for it can give. The build log is a transcript — it
 * says what was attempted, in provider-speak, and scrolls the answer away. The
 * `outputs` blob only lands when the whole run goes ready, so it says nothing
 * at all during the ten minutes an organizer actually wants to watch.
 *
 * Rows are upserted on (run_id, kind, key), so a run that is retried or grown
 * updates what it already recorded rather than listing it twice — and the
 * things that are created one at a time (accounts, Harness projects) carry
 * `done`/`total` and count up in place instead of adding a row per attendee.
 *
 * Deleted by the reaper when the run is torn down: this table says what is
 * standing right now, so it must not outlive the resources it describes.
 */
export const runResources = pgTable(
  "run_resources",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workshopRuns.id, { onDelete: "cascade" }),
    /** One of RESOURCE_KINDS; decides the icon and the fallback label. */
    kind: text("kind").notNull(),
    /** Identity within the run and kind — the cloud, the address, or "". */
    key: text("key").notNull().default(""),
    /** What to call it: "GKE cluster", "Attendee accounts". */
    label: text("label").notNull(),
    /** The identifier itself — a project id, an org unit path, a name. */
    detail: text("detail"),
    /** Where to go to see it, when the provider has a console page for it. */
    url: text("url"),
    /** For items built one at a time: how many exist, out of how many. */
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
    // The page's query: everything this run has built, in the order it was.
    index("run_resources_run_idx").on(t.runId, t.id),
    uniqueIndex("run_resources_identity_idx").on(t.runId, t.kind, t.key),
  ],
);

/* ------------------------------------------------------------------ *
 * Harness components — the catalog deployed into every workshop org
 * ------------------------------------------------------------------ */

/**
 * What a component builds in Harness. Each maps to one create in the runner's
 * Harness client; the kind decides which, and what shape `spec` takes.
 */
export const COMPONENT_KINDS = [
  "secret_text",
  "secret_file",
  "connector",
] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/**
 * Where a component is created. `org` is once per workshop; `project` is once
 * per attendee, in the project they administer — the difference between "every
 * room shares this connector" and "everyone gets their own copy to edit".
 */
export const COMPONENT_SCOPES = ["org", "project"] as const;
export type ComponentScope = (typeof COMPONENT_SCOPES)[number];

/**
 * How far a candidate set has got. A set is created by a sandbox test, so it
 * exists as `testing` before anyone decides to offer it; `submitted` is the
 * contributor saying it is ready, and approval folds its components into the
 * baseline rather than leaving them addressable here.
 */
export const COMPONENT_SET_STATUSES = [
  "testing",
  "submitted",
  "approved",
  "rejected",
] as const;
export type ComponentSetStatus = (typeof COMPONENT_SET_STATUSES)[number];

/**
 * A candidate set: one contributor's proposed additions, overlaid on the
 * published baseline for a sandbox run.
 *
 * A set exists from the moment someone tests, not from the moment they submit,
 * and that is the point — testing is what puts the work in the database, so
 * submitting is a change of status rather than an upload. There is nothing to
 * import and no way for what was reviewed to differ from what was tested.
 *
 * The baseline itself is not a set. Baseline components are the rows with a
 * null `setId`, which keeps "what every workshop gets" a single unambiguous
 * query instead of a lookup for the blessed set's id.
 */
export const harnessComponentSets = pgTable(
  "harness_component_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** What the contributor called it: "Add GKE deploy template". */
    name: text("name").notNull(),
    status: text("status").notNull().default("testing"),
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Reviewer's notes, and the reason on a rejection. */
    notes: text("notes").notNull().default(""),
    /*
     * There is deliberately no `runId` here. The sandbox runs that exercised a
     * set are the rows in `workshopRuns` whose `componentSetId` is this one —
     * which is the same fact, cannot disagree with itself, and keeps the two
     * tables from referencing each other in a cycle that `db:push` would then
     * have to find an order for.
     */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("harness_component_sets_status_idx").on(t.status, t.updatedAt)],
);

/**
 * One secret, connector, or template the runner creates in a workshop's org.
 *
 * These used to be TypeScript: a function per connector in the runner's Harness
 * client, their identifiers in environment variables, and their order given by
 * where the calls happened to sit in the provisioning routine. That works for
 * three hand-written pairs and for nobody outside the repo. As data they can be
 * ordered by their real dependencies, contributed by people without commit
 * access, and reviewed before they run.
 *
 * `spec` is the Harness payload for the kind, with `${...}` bindings for the
 * parts only a run knows — the org it landed in, an attendee's address, a
 * credential Terraform just minted. See `resolveBindings` in the runner.
 *
 * Dependencies are declared in `dependsOn` *and* inferred from `org.<id>`
 * references inside `spec`, because a contributor who writes the reference has
 * already said what they depend on and should not have to say it twice.
 */
export const harnessComponents = pgTable(
  "harness_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The candidate set this belongs to, or null for the published baseline —
     * the components every workshop gets.
     */
    setId: uuid("set_id").references(() => harnessComponentSets.id, {
      onDelete: "cascade",
    }),
    /**
     * The Harness identifier, and this catalog's primary key by any other name:
     * it is what `org.<identifier>` references resolve against, so it is how
     * dependencies are expressed and how a candidate overlays a baseline row.
     * Must satisfy Harness's identifier rules — see `harnessIdentifier`.
     */
    identifier: text("identifier").notNull(),
    /** One of COMPONENT_KINDS. */
    kind: text("kind").notNull(),
    /** One of COMPONENT_SCOPES. */
    scope: text("scope").notNull().default("org"),
    /** Display name in the Harness console. */
    name: text("name").notNull(),
    /** What it is for, shown to contributors and reviewers. */
    description: text("description").notNull().default(""),
    /** The Harness payload for `kind`, with `${...}` bindings unresolved. */
    spec: jsonb("spec").notNull(),
    /**
     * Binding paths that must resolve before this can be created, e.g.
     * `outputs.harness_gcp_key_json`. An unsatisfied requirement is not always
     * an error: see `applyCatalog` for when it means "not applicable to this
     * run" and when it means the run is broken.
     */
    requires: jsonb("requires").notNull().default([]),
    /** Identifiers this must be created after, beyond what `spec` implies. */
    dependsOn: jsonb("depends_on").notNull().default([]),
    /**
     * Seeded from the repo rather than contributed. Editable, but not
     * deletable: a workshop with no cloud connector is not a workshop.
     */
    builtin: boolean("builtin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // An identifier names exactly one thing in the baseline, and exactly one
    // thing within a candidate set — but a candidate may reuse a baseline
    // identifier, which is how it proposes replacing it.
    uniqueIndex("harness_components_baseline_idx")
      .on(t.identifier)
      .where(sql`set_id is null`),
    uniqueIndex("harness_components_set_idx")
      .on(t.setId, t.identifier)
      .where(sql`set_id is not null`),
    index("harness_components_set_list_idx").on(t.setId, t.identifier),
  ],
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

/* ------------------------------------------------------------------ *
 * Site settings — configuration an administrator changes from the app
 * ------------------------------------------------------------------ */

/**
 * Email domains allowed to sign in, managed from the admin settings page.
 *
 * An empty table means no restriction: anyone with a Google account signs in
 * as an operator, which is what the site does before anybody configures it.
 * `AUTH_ALLOWED_EMAIL_DOMAINS` is unioned with these rows and cannot be edited
 * from the app — it is the same bootstrap-from-outside idea as
 * `SITE_ADMIN_EMAILS`, and the way back in if these rows are ever wrong.
 *
 * `domain` is stored bare and lowercased (`example.com`) — normalized on the
 * way in by `normalizeDomain`, so the unique index actually means one row per
 * domain rather than one per spelling of it.
 */
export const allowedEmailDomains = pgTable(
  "allowed_email_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    domain: text("domain").notNull(),
    /** Why it is on the list — "the partner running the March workshops". */
    note: text("note").notNull().default(""),
    /** Who added it. Kept when they are deleted — the rule outlives them. */
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("allowed_email_domains_domain_idx").on(t.domain)],
);

/** Longest domain the form accepts. The DNS limit on a whole name. */
export const ALLOWED_DOMAIN_LIMITS = { domain: 253, note: 200 } as const;

export type AllowedEmailDomain = typeof allowedEmailDomains.$inferSelect;

export type WorkshopRun = typeof workshopRuns.$inferSelect;
export type LabGuide = typeof labGuides.$inferSelect;
export type LabWorkshop = typeof labWorkshops.$inferSelect;
export type LabImage = typeof labImages.$inferSelect;
export type WorkshopAccount = typeof workshopAccounts.$inferSelect;
export type RunLog = typeof runLogs.$inferSelect;
export type RunResource = typeof runResources.$inferSelect;
export type RunStatus = (typeof runStatus.enumValues)[number];
