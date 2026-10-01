import type { EndpointGroup } from "./types";

const ORG_SECRET_ROW =
  "{ id, identifier, kind: \"text\" | \"file\", fileName: string | null, bytes: number, createdAt, updatedAt, updatedBy: string | null, usable: boolean }";

const TEMPLATE_SOURCE_ROW =
  "{ id, accountId, accountName: string | null, orgIdentifier, orgName: string | null, projectIdentifier: string | null, projectName: string | null, tail, createdAt, addedBy: string | null, usable: boolean, mine: boolean }";

const SOURCE_STATUS =
  "{ tokenOk: boolean, orgOk: boolean, projectOk: boolean | null, ok: boolean, detail?: string }";

const HARNESS_TOKEN_SUMMARY =
  "{ id, kind: \"pat\" | \"sat\", accountId, accountName: string | null, principal: string | null, principalType: string | null, tail, permissions: { permission, resourceType, permitted: boolean }[], verifiedAt: string | null, createdAt, usable: boolean, lastDeploy: { orgName, orgIdentifier, orgUrl, at, content: { official: boolean, mySecrets: boolean, myTemplates: string[] } | null } | null, scrub: { pending, scrubbed, skipped, failed, dueAt: string | null, scrubbedAt: string | null, orgs: string[], problems: { secretIdentifier, orgIdentifier, status, note: string | null }[] } }";

const SCRUB_RUN =
  "{ scrubbed: number, skipped: number, failed: number, problems: { secretIdentifier, status: \"skipped\" | \"failed\", note: string | null }[] }";

const ID_PARAM = (what: string) => [
  { name: "id", type: "string", required: true, note: `UUID of the ${what}` },
];

const ORG_SECRET_FORM = [
  {
    name: "identifier",
    type: "string",
    required: true,
    note: "Harness identifier: a letter or _ first, then letters, digits, _ $ -; 128 characters at most; trimmed",
  },
  { name: "kind", type: "\"text\" | \"file\"", required: true },
  {
    name: "value",
    type: "string",
    note: "required when kind is text; 1 byte to 256 KiB",
  },
  {
    name: "file",
    type: "file",
    note: "required when kind is file; 1 byte to 256 KiB of UTF-8 text; its file name is kept (255 characters at most)",
  },
];

const ORG_SECRET_ERRORS = [
  { status: 400, error: "malformed", when: "the body is not form data, kind is not text or file, or the value or file is missing" },
  { status: 400, error: "invalid_identifier", when: "identifier does not match the Harness rules" },
  { status: 400, error: "empty", when: "the value or file is empty" },
  { status: 413, error: "too_large", when: "the value or file is over 256 KiB" },
  { status: 415, error: "binary", when: "the file is not valid UTF-8 text" },
  { status: 409, error: "duplicate", when: "another secret of the same owner already has that identifier" },
  { status: 503, error: "no_key", when: "secrets encryption isn't configured (no HARNESS_TOKEN_ENC_KEY or AUTH_SECRET)" },
];

const TEMPLATE_SOURCE_BODY = [
  { name: "token", type: "string", required: true, note: "a Harness pat. or sat. token that can read the organization" },
  { name: "org", type: "string", required: true, note: "the Harness organization identifier to read templates from" },
  { name: "project", type: "string", note: "a project identifier in that organization; omit to read at org level" },
];

const TEMPLATE_SOURCE_ERRORS = [
  { status: 400, error: "malformed", when: "token or org is missing, or the token is not shaped like a Harness token" },
  { status: 409, error: "duplicate", when: "the same token is already saved for that organization and project" },
  { status: 409, error: "too_many", when: "the owner already has 25 template sources" },
  { status: 409, error: "invalid_token", when: "Harness answered 401, or could not be reached" },
  { status: 409, error: "org_not_found", when: "org is blank, or the token cannot see that organization" },
  { status: 409, error: "project_not_found", when: "the token cannot see that project" },
  { status: 503, error: "no_key", when: "secrets encryption isn't configured" },
];

const LOOKUP_BODY = [
  { name: "token", type: "string", required: true, note: "a Harness pat. or sat. token; not stored" },
  { name: "org", type: "string", note: "an organization identifier; when given, lists its projects instead of the account's organizations" },
];

const LOOKUP_ERRORS = [
  { status: 400, error: "malformed", when: "token is missing or blank, or not shaped like a Harness token" },
  { status: 409, error: "invalid_token", when: "Harness answered 401 or 403" },
  { status: 502, error: "harness_error", when: "Harness answered with another error" },
  { status: 504, error: "unreachable", when: "Harness could not be reached" },
];

const REPO_BODY = [
  {
    name: "url",
    type: "string",
    required: true,
    note: "a github.com repository URL, owner/name only (no file, branch or PR links); 500 characters at most",
  },
  {
    name: "identifier",
    type: "string",
    note: "the Harness Code repository name; defaults to the GitHub name; a letter or digit first, then letters, digits, . _ -; 100 characters at most",
  },
  {
    name: "scope",
    type: "\"org\" | \"project\"",
    required: true,
    note: "import once into the event's organization, or into every attendee's project",
  },
];

const REPO_ERRORS = [
  { status: 400, error: "invalid_url", when: "the body is not JSON, or url is missing or not a GitHub owner/name URL" },
  { status: 400, error: "invalid_identifier", when: "the identifier breaks the naming rules" },
  { status: 400, error: "invalid_scope", when: "scope is not org or project" },
  { status: 409, error: "duplicate", when: "another repository already has that identifier in that scope" },
];

export const ACCOUNT_GROUPS: EndpointGroup[] = [
  {
    id: "account",
    title: "Your account",
    endpoints: [
      {
        method: "GET",
        path: "/api/me",
        summary: "Returns who you are, your roles, and your saved preferences.",
        access: "signedIn",
        token: true,
        returns:
          "{ id, email: string | null, access: { event, training: string | null, evals: string | null, platform: boolean }, preferences: { themePreference: \"light\" | \"dark\" | \"system\", calendarScope: \"own\" | \"all\" } }",
      },
      {
        method: "PATCH",
        path: "/api/me",
        summary: "Saves whichever preferences you send.",
        access: "signedIn",
        token: true,
        notes:
          "Every field is checked before anything is saved, so one bad field saves nothing. An empty object changes nothing.",
        body: {
          kind: "json",
          fields: [
            { name: "themePreference", type: "\"light\" | \"dark\" | \"system\"" },
            { name: "calendarScope", type: "\"own\" | \"all\"", note: "Event Manager or above only" },
          ],
        },
        returns: "{ preferences: { themePreference, calendarScope } }",
        errors: [
          { status: 400, error: "invalid_body", when: "the body is not a JSON object" },
          { status: 400, error: "invalid", when: "a value is not one of the allowed ones" },
          { status: 403, error: "forbidden", when: "calendarScope is sent by someone below Event Manager" },
        ],
      },
      {
        method: "GET",
        path: "/api/tokens",
        summary: "Lists your personal access tokens, including expired and revoked ones.",
        access: "signedIn",
        token: false,
        notes: "Session only: a personal access token gets 401. The token values are never returned.",
        returns:
          "{ tokens: { id, name, source: \"manual\" | \"bundle\", prefix, status: \"active\" | \"expired\" | \"revoked\", createdAt, expiresAt, lastUsedAt: string | null }[] }",
      },
      {
        method: "POST",
        path: "/api/tokens",
        summary: "Creates a personal access token.",
        access: "signedIn",
        token: false,
        notes:
          "Session only, so a token cannot mint its own replacement. The token lasts 30 days. Its value is in this response only; just its SHA-256 is stored. You can hold 5 active tokens; old bundle tokens do not count.",
        body: {
          kind: "json",
          fields: [
            { name: "name", type: "string", required: true, note: "trimmed; cut to 80 characters" },
          ],
        },
        returns: "201 { token: { id, name, prefix, expiresAt, token } }",
        errors: [
          { status: 400, error: "invalid_name", when: "name is missing or blank (with a message)" },
          { status: 409, error: "too_many", when: "you already have 5 active tokens (with a message)" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/tokens/{id}",
        summary: "Revokes one of your personal access tokens.",
        access: "signedIn",
        token: false,
        notes: "Session only. Takes effect on the next request made with that token.",
        params: ID_PARAM("token"),
        returns: "{ id, status: \"revoked\" }",
        errors: [
          { status: 404, error: "not_found", when: "no such token of yours, or it is already revoked" },
        ],
      },
    ],
  },
  {
    id: "harness-tokens",
    title: "Your Harness tokens",
    intro:
      "Harness platform tokens you save so content can be deployed into that Harness account. The token value is write-only: responses show only its last four characters (tail).",
    endpoints: [
      {
        method: "GET",
        path: "/api/me/harness-tokens",
        summary: "Lists your saved Harness tokens and what a deploy could put in.",
        access: "signedIn",
        token: true,
        notes:
          "configured is false when secrets encryption isn't set up. scrubDays is how long a deployed secret keeps its real value (default 7).",
        returns:
          `{ tokens: ${HARNESS_TOKEN_SUMMARY}[], choices: { official: { secrets: number, sources: number }, mySecrets: number, myTemplates: ${TEMPLATE_SOURCE_ROW}[] }, configured: boolean, scrubDays: number }`,
      },
      {
        method: "POST",
        path: "/api/me/harness-tokens",
        summary: "Checks a Harness token with Harness and saves it, encrypted.",
        access: "signedIn",
        token: true,
        notes:
          "Calls the Harness account the token belongs to (ACL check, account name, current user) to record its permissions. You can save 10 tokens. Error bodies carry Harness's message in detail when it gave one.",
        body: {
          kind: "json",
          fields: [
            { name: "token", type: "string", required: true, note: "pat.<account>.<id>.<secret> or sat.…" },
          ],
        },
        returns: `201 { token: ${HARNESS_TOKEN_SUMMARY} }`,
        errors: [
          { status: 400, error: "malformed", when: "token is missing, blank or not shaped like a Harness token" },
          { status: 409, error: "duplicate", when: "you already saved this token" },
          { status: 409, error: "too_many", when: "you already have 10 saved tokens" },
          { status: 409, error: "invalid_token", when: "Harness answered 401 or 403" },
          { status: 502, error: "harness_error", when: "Harness answered with another error" },
          { status: 504, error: "unreachable", when: "Harness could not be reached" },
          { status: 503, error: "no_key", when: "secrets encryption isn't configured" },
        ],
      },
      {
        method: "POST",
        path: "/api/me/harness-tokens/{id}",
        summary: "Re-checks a saved token with Harness and refreshes its permissions.",
        access: "signedIn",
        token: true,
        notes:
          "Calls the token's Harness account. If Harness rejects it, the token is marked unverified (verifiedAt becomes null).",
        params: ID_PARAM("saved Harness token"),
        returns: `{ token: ${HARNESS_TOKEN_SUMMARY} }`,
        errors: [
          { status: 404, error: "not_found", when: "no such token of yours" },
          { status: 409, error: "unreadable", when: "the stored token can no longer be decrypted" },
          { status: 409, error: "invalid_token", when: "Harness answered 401 or 403" },
          { status: 502, error: "harness_error", when: "Harness answered with another error" },
          { status: 504, error: "unreachable", when: "Harness could not be reached" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/me/harness-tokens/{id}",
        summary: "Scrubs what the token deployed, then forgets the token.",
        access: "signedIn",
        token: true,
        notes:
          "Before deleting, it runs the same scrub as POST …/scrub against the real Harness account, if the token can still be decrypted. A failed scrub does not stop the delete (scrub is then null). Any secret it could not scrub keeps its real value in Harness; remove it by hand.",
        params: ID_PARAM("saved Harness token"),
        returns: `{ id, status: "removed", scrub: ${SCRUB_RUN} | null }`,
        errors: [{ status: 404, error: "not_found", when: "no such token of yours" }],
      },
      {
        method: "POST",
        path: "/api/me/harness-tokens/{id}/deploy",
        summary: "Creates a Harness organization with the token and fills it with the content you pick.",
        access: "eventAdmin",
        token: true,
        notes:
          "Writes to the real Harness account the token belongs to, and the token needs core_account_edit there. It creates the organization, then writes org secrets with their real values (your own win over the site's when identifiers match), then copies connectors, variables, templates, environments and infrastructure, policies, policy sets and filters from each template source, creating projects for project-level sources. Each deployed secret is overwritten with a placeholder after the scrub window. Sending the same org name as this token's last deploy re-runs into that organization and leaves what is already there alone. Problems with single items are reported in steps, not as HTTP errors. Can take up to 300 seconds.",
        params: ID_PARAM("saved Harness token"),
        body: {
          kind: "json",
          fields: [
            { name: "org", type: "string", required: true, note: "the organization's name; its identifier is derived from it" },
            { name: "official", type: "boolean", note: "the site's org secrets and template sources; default false" },
            { name: "mySecrets", type: "boolean", note: "your own org secrets; default false" },
            { name: "myTemplates", type: "string[]", note: "ids of your own template sources to copy from; default []" },
          ],
        },
        returns:
          "{ report: { orgIdentifier, orgName, orgUrl, steps: { scope, kind, identifier, outcome: \"created\" | \"existed\" | \"failed\" | \"skipped\", detail?: string }[], counts: { created, existed, failed, skipped }, sources: number } }",
        errors: [
          { status: 400, error: "invalid_name", when: "org is missing, or has no letter, digit or underscore in it" },
          { status: 400, error: "nothing_selected", when: "official, mySecrets and myTemplates are all off or empty" },
          { status: 404, error: "not_found", when: "no such token of yours" },
          { status: 409, error: "unreadable", when: "the stored token can no longer be decrypted" },
          { status: 409, error: "invalid_token", when: "Harness rejected the token, or it is not shaped like one" },
          { status: 403, error: "not_permitted", when: "the token no longer has core_account_edit on the account" },
          { status: 409, error: "org_exists", when: "an organization with that identifier already exists and this is not a re-run" },
          { status: 502, error: "org_failed", when: "Harness would not create the organization; nothing else was deployed" },
          { status: 502, error: "harness_error", when: "the permission check got another error from Harness" },
          { status: 504, error: "unreachable", when: "Harness could not be reached" },
        ],
      },
      {
        method: "POST",
        path: "/api/me/harness-tokens/{id}/scrub",
        summary: "Overwrites the secret values this token deployed, now rather than when the window ends.",
        access: "eventAdmin",
        token: true,
        notes:
          "Writes to the real Harness account the token belongs to. Nothing is deleted: each deployed secret not yet scrubbed or skipped gets its value replaced with the placeholder 123 and a placeholder tag. A secret someone changed in Harness since the deploy is skipped and left alone; one already gone counts as scrubbed. The organization and copied content stay. Can take up to 120 seconds.",
        params: ID_PARAM("saved Harness token"),
        returns: `{ run: ${SCRUB_RUN} }`,
        errors: [
          { status: 404, error: "not_found", when: "no such token of yours" },
          { status: 409, error: "unreadable", when: "the stored token can no longer be decrypted" },
        ],
      },
    ],
  },
  {
    id: "my-org-secrets-templates",
    title: "Your org secrets and templates",
    intro:
      "Your own content for deploys made with your Harness tokens. Secret values and template-source tokens are write-only: no endpoint returns them.",
    endpoints: [
      {
        method: "GET",
        path: "/api/me/org-secrets",
        summary: "Lists your own org secrets, without their values.",
        access: "signedIn",
        token: true,
        notes: "configured is false when secrets encryption isn't set up. usable is false when a value can no longer be decrypted.",
        returns: `{ secrets: ${ORG_SECRET_ROW}[], configured: boolean }`,
      },
      {
        method: "POST",
        path: "/api/me/org-secrets",
        summary: "Adds one of your own org secrets, encrypted.",
        access: "signedIn",
        token: true,
        notes: "Write-only: the value is never returned. A deploy that ticks mySecrets writes it, and it wins over a site secret with the same identifier.",
        body: { kind: "multipart", fields: ORG_SECRET_FORM },
        returns: `201 { secret: ${ORG_SECRET_ROW} }`,
        errors: ORG_SECRET_ERRORS,
      },
      {
        method: "PATCH",
        path: "/api/me/org-secrets/{id}",
        summary: "Replaces one of your own org secrets.",
        access: "signedIn",
        token: true,
        notes: "A full replace: send the identifier, kind and value or file again. Write-only, like POST.",
        params: ID_PARAM("org secret"),
        body: { kind: "multipart", fields: ORG_SECRET_FORM },
        returns: `{ secret: ${ORG_SECRET_ROW} }`,
        errors: [
          ...ORG_SECRET_ERRORS,
          { status: 404, error: "not_found", when: "no such secret of yours" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/me/org-secrets/{id}",
        summary: "Removes one of your own org secrets.",
        access: "signedIn",
        token: true,
        notes: "Copies already deployed into Harness are not touched.",
        params: ID_PARAM("org secret"),
        returns: "{ id, status: \"removed\" }",
        errors: [{ status: 404, error: "not_found", when: "no such secret of yours" }],
      },
      {
        method: "GET",
        path: "/api/me/templates",
        summary: "Lists your own template sources.",
        access: "signedIn",
        token: true,
        notes: "With ?status=1 it checks each source live with Harness, which is slow. The stored tokens are never returned.",
        query: [
          { name: "status", type: "\"1\"", note: "add a live check of each source" },
        ],
        returns: `{ sources: ${TEMPLATE_SOURCE_ROW}[], status?: Record<id, ${SOURCE_STATUS}>, configured: boolean }`,
      },
      {
        method: "POST",
        path: "/api/me/templates",
        summary: "Checks a Harness token can see an organization or project, and saves it as one of your template sources.",
        access: "signedIn",
        token: true,
        notes:
          "Calls Harness with the token. The token is stored encrypted and is write-only. You can save 25 sources. Error bodies carry Harness's message in detail when it gave one.",
        body: { kind: "json", fields: TEMPLATE_SOURCE_BODY },
        returns: `201 { source: ${TEMPLATE_SOURCE_ROW} }`,
        errors: TEMPLATE_SOURCE_ERRORS,
      },
      {
        method: "DELETE",
        path: "/api/me/templates/{id}",
        summary: "Forgets one of your own template sources.",
        access: "signedIn",
        token: true,
        notes: "Only the saved token goes; nothing changes in Harness.",
        params: ID_PARAM("template source"),
        returns: "{ id, status: \"removed\" }",
        errors: [{ status: 404, error: "not_found", when: "no such source of yours" }],
      },
      {
        method: "POST",
        path: "/api/me/templates/lookup",
        summary: "Lists the organizations a Harness token can see, or one organization's projects.",
        access: "signedIn",
        token: true,
        notes: "Calls Harness with the token you send and stores nothing.",
        body: { kind: "json", fields: LOOKUP_BODY },
        returns: "{ scopes: { identifier, name }[] }  (sorted by name)",
        errors: LOOKUP_ERRORS,
      },
    ],
  },
  {
    id: "event-settings",
    title: "Event settings",
    intro:
      "The site's own org secrets, template sources and repositories, which every workshop and every deploy with official ticked uses.",
    endpoints: [
      {
        method: "GET",
        path: "/api/settings/org-secrets",
        summary: "Lists the site's org secrets, without their values.",
        access: "eventAdmin",
        token: true,
        notes: "configured is false when secrets encryption isn't set up. usable is false when a value can no longer be decrypted.",
        returns: `{ secrets: ${ORG_SECRET_ROW}[], configured: boolean }`,
      },
      {
        method: "POST",
        path: "/api/settings/org-secrets",
        summary: "Adds an org secret every workshop's Harness organization gets.",
        access: "eventAdmin",
        token: true,
        notes: "Write-only: the value is stored encrypted and never returned.",
        body: { kind: "multipart", fields: ORG_SECRET_FORM },
        returns: `201 { secret: ${ORG_SECRET_ROW} }`,
        errors: ORG_SECRET_ERRORS,
      },
      {
        method: "PATCH",
        path: "/api/settings/org-secrets/{id}",
        summary: "Replaces one of the site's org secrets.",
        access: "eventAdmin",
        token: true,
        notes: "A full replace: send the identifier, kind and value or file again. Write-only, like POST.",
        params: ID_PARAM("org secret"),
        body: { kind: "multipart", fields: ORG_SECRET_FORM },
        returns: `{ secret: ${ORG_SECRET_ROW} }`,
        errors: [
          ...ORG_SECRET_ERRORS,
          { status: 404, error: "not_found", when: "no such site secret" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/settings/org-secrets/{id}",
        summary: "Removes one of the site's org secrets.",
        access: "eventAdmin",
        token: true,
        params: ID_PARAM("org secret"),
        returns: "{ id, status: \"removed\" }",
        errors: [{ status: 404, error: "not_found", when: "no such site secret" }],
      },
      {
        method: "GET",
        path: "/api/settings/templates",
        summary: "Lists the site's template sources.",
        access: "eventAdmin",
        token: true,
        notes: "With ?status=1 it checks each source live with Harness, which is slow. The stored tokens are never returned.",
        query: [
          { name: "status", type: "\"1\"", note: "add a live check of each source" },
        ],
        returns: `{ sources: ${TEMPLATE_SOURCE_ROW}[], status?: Record<id, ${SOURCE_STATUS}>, configured: boolean }`,
      },
      {
        method: "POST",
        path: "/api/settings/templates",
        summary: "Checks a Harness token can see an organization or project, and saves it as a site template source.",
        access: "eventAdmin",
        token: true,
        notes:
          "Calls Harness with the token. The token is stored encrypted and is write-only. The site can hold 25 sources. Error bodies carry Harness's message in detail when it gave one.",
        body: { kind: "json", fields: TEMPLATE_SOURCE_BODY },
        returns: `201 { source: ${TEMPLATE_SOURCE_ROW} }`,
        errors: TEMPLATE_SOURCE_ERRORS,
      },
      {
        method: "DELETE",
        path: "/api/settings/templates/{id}",
        summary: "Forgets a site template source.",
        access: "eventAdmin",
        token: true,
        notes: "Only the saved token goes; nothing changes in Harness.",
        params: ID_PARAM("template source"),
        returns: "{ id, status: \"removed\" }",
        errors: [{ status: 404, error: "not_found", when: "no such site source" }],
      },
      {
        method: "POST",
        path: "/api/settings/templates/lookup",
        summary: "Lists the organizations a Harness token can see, or one organization's projects.",
        access: "eventAdmin",
        token: true,
        notes: "Calls Harness with the token you send and stores nothing.",
        body: { kind: "json", fields: LOOKUP_BODY },
        returns: "{ scopes: { identifier, name }[] }  (sorted by name)",
        errors: LOOKUP_ERRORS,
      },
      {
        method: "GET",
        path: "/api/settings/repos",
        summary: "Lists the GitHub repositories every workshop imports into Harness.",
        access: "eventAdmin",
        token: true,
        returns:
          "{ repos: { id, url, providerRepo, identifier, scope: \"org\" | \"project\", createdAt, addedBy: string | null }[] }",
      },
      {
        method: "POST",
        path: "/api/settings/repos",
        summary: "Adds a GitHub repository for workshops to import.",
        access: "eventAdmin",
        token: true,
        body: { kind: "json", fields: REPO_BODY },
        returns: "201 { ok: true }",
        errors: REPO_ERRORS,
      },
      {
        method: "PATCH",
        path: "/api/settings/repos/{id}",
        summary: "Edits one of the repositories workshops import.",
        access: "eventAdmin",
        token: true,
        notes: "A full replace: url and scope are required again, and a blank identifier resets it to the GitHub name.",
        params: ID_PARAM("repository"),
        body: { kind: "json", fields: REPO_BODY },
        returns: "{ ok: true }",
        errors: [
          ...REPO_ERRORS,
          { status: 404, error: "not_found", when: "no such repository" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/settings/repos/{id}",
        summary: "Forgets one of the repositories workshops import.",
        access: "eventAdmin",
        token: true,
        notes: "Repositories already imported into Harness are not touched.",
        params: ID_PARAM("repository"),
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "no such repository" }],
      },
    ],
  },
];
