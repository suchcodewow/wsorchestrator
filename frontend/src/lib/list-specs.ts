/**
 * Every paged table's sorts and default order, in one pure module: the server
 * code that queries a table, the page that reads its URL, and the API
 * reference that documents its route all need the same list, and the
 * reference cannot import server code. See `src/lib/paging.ts`.
 */

import type { ListSpec } from "@/lib/paging";

function spec<const S extends string>(sorts: readonly [S, ...S[]], dir: "asc" | "desc" = "asc"): ListSpec<S> {
  return { sorts, sort: sorts[0], dir };
}

export const AUDIT_LIST = spec(["at", "actor", "action", "target", "outcome"], "desc");
export type AuditSort = (typeof AUDIT_LIST.sorts)[number];

export const EMPLOYEE_LIST = spec([
  "fullName",
  "email",
  "title",
  "department",
  "site",
  "reportsToName",
  "startDate",
  "activeEffectiveDate",
]);
export type EmployeeSort = (typeof EMPLOYEE_LIST.sorts)[number];

export const USER_LIST = spec(["user", "events", "eventRole", "trainingRole", "evalsRole", "platform"]);
export type UserSort = (typeof USER_LIST.sorts)[number];

export const TITLE_LIST = spec(["title", "addedBy", "createdAt"]);
export type TitleSort = (typeof TITLE_LIST.sorts)[number];

export const SLACK_CONTACT_LIST = spec(["fullName", "email", "addedBy", "createdAt"]);
export type SlackContactSort = (typeof SLACK_CONTACT_LIST.sorts)[number];

export const BOOTCAMP_HISTORY_LIST = spec(["fullName", "email"]);
export type BootcampHistorySort = (typeof BOOTCAMP_HISTORY_LIST.sorts)[number];

export const ORGANIZATION_LIST = spec([
  "depth",
  "fullName",
  "email",
  "title",
  "department",
  "reportsToName",
  "track",
  "btcDate",
  "btcScore",
  "intDate",
  "intScore",
]);
export type OrganizationSort = (typeof ORGANIZATION_LIST.sorts)[number];

export const CURRENT_COHORT_LIST = spec(["fullName", "email", "title", "department", "reportsToName", "track", "btcDate"]);
export type CurrentCohortSort = (typeof CURRENT_COHORT_LIST.sorts)[number];

export const BOOTCAMP_LIST = spec(["startDate", "status", "createdBy"], "desc");
export type BootcampSort = (typeof BOOTCAMP_LIST.sorts)[number];

export const HIBOB_SYNC_LIST = spec(["startedAt", "triggeredBy", "status"], "desc");
export type HibobSyncSort = (typeof HIBOB_SYNC_LIST.sorts)[number];

export const DOMAIN_LIST = spec(["domain", "note", "addedBy"]);
export type DomainSort = (typeof DOMAIN_LIST.sorts)[number];

export const REPO_LIST = spec(["identifier", "providerRepo", "scope", "addedBy"]);
export type RepoSort = (typeof REPO_LIST.sorts)[number];

export const ORG_SECRET_LIST = spec(["identifier", "kind", "updatedAt", "updatedBy"]);
export type OrgSecretSort = (typeof ORG_SECRET_LIST.sorts)[number];
