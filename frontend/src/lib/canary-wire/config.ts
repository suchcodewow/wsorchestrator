/**
 * The Canary Wire's fixed settings, carried over from canary-wire-reports'
 * config.yml. Changing one is a code change and a deploy, not a new pull:
 * none of them are stored with the data.
 */

export type SeriesLink = { edition: string; label: string; url: string };

/**
 * Each edition's own page in Mindtickle, for the header and the Slack paste.
 * A series deeplink is an opaque short code that maps to nothing the API
 * returns, so these were pasted in by hand; one without a URL just isn't linked.
 */
export const SERIES_LINKS: SeriesLink[] = [
  { edition: "AE and Supporting Orgs", label: "AE", url: "https://deeplinks.mindtickle.com/Q3TTcWULx3b" },
  { edition: "SE", label: "SE", url: "https://deeplinks.mindtickle.com/69I8UeqLC3b" },
  { edition: "SDR", label: "SDR", url: "https://deeplinks.mindtickle.com/zIdgXJsLC3b" },
];

export type Edition = {
  edition: string;
  /** Every one of these must appear in the series' name, so exactly one series matches. */
  match: string[];
  /**
   * The role group whose members owe this edition. Accountability comes from
   * the group, not from enrollment in the series: opening another edition's
   * module enrolls you in it. Matched exactly, as Mindtickle offers no way to
   * list groups and correct a near miss.
   */
  group: string;
};

/** In order: someone in two groups is counted once, under the first. */
export const EDITIONS: Edition[] = [
  { edition: "AE and Supporting Orgs", match: ["canary wire", "ae/supporting"], group: "Canary Wire - AE and Supporting Roles" },
  { edition: "SE", match: ["canary wire", "se edition"], group: "Canary Wire - SE" },
  { edition: "SDR", match: ["canary wire", "sdr edition"], group: "Canary Wire - SDR" },
];

/**
 * The order a month's columns run in: AE's own modules, then those AE and SE
 * share, then SE's own, each group by name. SDR's lineup is drawn from the
 * same content, so it rarely adds a column; one only SDR has goes last.
 */
export const COLUMN_ORDER = { first: "AE and Supporting Orgs", second: "SE" } as const;

/**
 * Editions whose reps never attend bootcamp, so they owe the Canary Wire from
 * their first month whatever bootcamp history says. SDRs don't go to bootcamp
 * at all (Preston, 2026-10-05), which is why only 4 of 14 had a record.
 */
export const NO_BOOTCAMP_EDITIONS = ["SDR"];

/** Modules whose name contains any of these are left out entirely. */
export const EXCLUDE_MODULES = ["survey"];

/**
 * The `userState`s that count as a current learner. Departed staff stay in
 * their role group as `DEACTIVATED` — a quarter of it — and never complete
 * anything, so they would drag every rate down. `ADDED` stays: those are
 * current employees who have never activated Mindtickle, and the page labels them.
 */
export const INCLUDE_USER_STATES = ["ACTIVE", "ADDED"];

/**
 * A module's learner URL. The API publishes none, so the pattern was worked
 * out from one real learner URL and confirmed against the live tenant on
 * 2026-10-01. `{series_id}` is not a constant: most module ids sit in more
 * than one edition, and a link through the wrong series lands the rep
 * somewhere they aren't enrolled. The real URL's `loId` and `topicId` are left
 * off: they address a spot inside the module and appear in no API.
 * An empty string turns every link off.
 */
export const MODULE_URL_TEMPLATE =
  "https://flightdeck.harness.io/new/ui/learner/{module_type}/{module_id}/consume?series={series_id}";
