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
