/** The shape of an entry in the API reference catalog. */

import {
  EVALS_ROLE_LABELS,
  EVENT_ROLE_LABELS,
  PLATFORM_ADMIN_LABEL,
} from "@/lib/roles";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Who may call it:
 *   public       anyone, signed in or not
 *   signedIn     any signed-in account (things that are only ever your own)
 *   contributor  Event Contributor or above            (canUseEvents / canContributeComponents)
 *   operator     Event Operator or above               (canCreateEvents)
 *   eventOwner   the event's owner, or Event Manager or above
 *   manager      Event Manager or above                (canSeeAllEvents, canManageLabGuides, canPublishComponents)
 *   eventAdmin   Event Administrator                   (canManageSettings, canAuditProjects)
 *   evalsAdmin   eVals Administrator                   (canManageEvalsSettings)
 *   userAdmin    an administrator in any area          (canManageUsers)
 *   platform     Platform Administrator                (canRunSql, canManageBackups, canManageSignInDomains, canDeleteUsers)
 *   internal     not for people: Cloud Scheduler or runner OIDC, or Auth.js
 * A platform administrator passes every check, so no entry says so.
 */
export type AccessKey =
  | "public"
  | "signedIn"
  | "contributor"
  | "operator"
  | "eventOwner"
  | "manager"
  | "eventAdmin"
  | "evalsAdmin"
  | "userAdmin"
  | "platform"
  | "internal";

export const ACCESS_LABELS: Record<AccessKey, string> = {
  public: "Anyone",
  signedIn: "Any signed-in account",
  contributor: `${EVENT_ROLE_LABELS.contributor} or above`,
  operator: `${EVENT_ROLE_LABELS.operator} or above`,
  eventOwner: `The event's owner, or ${EVENT_ROLE_LABELS.manager} or above`,
  manager: `${EVENT_ROLE_LABELS.manager} or above`,
  eventAdmin: EVENT_ROLE_LABELS.administrator,
  evalsAdmin: EVALS_ROLE_LABELS.administrator,
  userAdmin: "An administrator in any area",
  platform: PLATFORM_ADMIN_LABEL,
  internal: "Internal",
};

export type Field = {
  name: string;
  type: string;
  required?: boolean;
  note?: string;
};

export type Endpoint = {
  method: Method;
  /** With {braces} for path params: "/api/runs/{id}". */
  path: string;
  summary: string;
  access: AccessKey;
  /** False only where the handler calls auth() directly and so refuses a personal access token. */
  token: boolean;
  notes?: string;
  params?: Field[];
  query?: Field[];
  body?: { kind: "json" | "multipart"; fields: Field[] };
  /** Shape of a success body, short: "{ runs: Run[] }", "204 No Content". */
  returns: string;
  /** Status codes past the 401/403 gate. */
  errors?: { status: number; error?: string; when: string }[];
};

export type EndpointGroup = {
  id: string;
  title: string;
  intro?: string;
  endpoints: Endpoint[];
};

/** The anchor an endpoint is linked by: "get-api-runs-id". */
export function endpointAnchor(e: Pick<Endpoint, "method" | "path">): string {
  return `${e.method}-${e.path}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
