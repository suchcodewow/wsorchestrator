# The API

Everything the site does goes through `/api/*` route handlers, and almost all of
them take a personal access token in place of a browser session. A script can
read what a page shows and make the changes a page makes, as you and with your
roles.

The reference for every endpoint is published on the site itself at
[`/api`](https://harnessevents.io/api). It covers each endpoint's role, body,
response and errors. It is built from
[`frontend/src/lib/api-reference/`](../frontend/src/lib/api-reference/), and
`test/unit/api-reference.test.ts` fails when a route handler is missing from
that catalog, or when an entry describes a handler that no longer exists or
gets session-only wrong. A new route therefore needs a catalog entry before
the unit suite passes. This file covers the parts that sit behind the
reference.

## Getting a token

**My settings → My API tokens** (`/me/api-tokens`).

- A token looks like `wo_<16 hex>_<secret>`. Only its SHA-256 is stored, so it
  is shown once, when it is created.
- It lasts 30 days (`TOKEN_TTL_DAYS`). Revoking it takes effect on the next
  request.
- Each account can have 5 active tokens (`MAX_TOKENS_PER_USER`). Tokens marked
  "in a download" came with the contributor bundle, which has been removed. They
  still work until they expire and do not count toward the limit.
- A token has no scopes. It carries its owner's roles, which are read from
  `users` on every request. Changing someone's roles therefore changes what
  their tokens can do straight away.

## Using it

```bash
export TOKEN="wo_..."
curl -H "Authorization: Bearer $TOKEN" https://harnessevents.io/api/me
curl -H "Authorization: Bearer $TOKEN" "https://harnessevents.io/api/runs/calendar?scope=all"
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"themePreference":"dark"}' https://harnessevents.io/api/me
```

If a request carries both a session cookie and a token, the session wins.
Responses are JSON:

- `401 {"error":"unauthorized"}`: no session, or the token is missing, revoked,
  expired or malformed.
- `403 {"error":"forbidden"}`: the owner's roles do not allow the request.

The gate is `requireCaller` in
[`frontend/src/lib/api-auth.ts`](../frontend/src/lib/api-auth.ts).

## Session-only routes

These refuse a token with 401, even when it belongs to someone who could do the
same thing in a browser. Each one either touches every account at once or can
escalate itself:

| Route | Why |
| --- | --- |
| `/api/backups/**` | Taking, restoring and importing backups |
| `PATCH`/`DELETE /api/users/[id]`, `POST /api/users/invites`, `POST /api/invites/accept` | Granting roles and creating accounts |
| `POST /api/settings/domains`, `PATCH`/`DELETE /api/settings/domains/[id]` | Who can sign in at all |
| `/api/tokens/**` | Minting tokens (a token must not be able to mint its own replacement) |

You can still *read* users (`GET /api/users`) and sign-in domains
(`GET /api/settings/domains`) with a token.

To make a new route session-only, call `auth()` directly instead of going
through `requireCaller`. Then mark it `sessionOnly: true` in the e2e matrix
(`frontend/test/e2e/roles.test.ts`), give its catalog entry `token: false`, and
add it to the table above.

## What a page shows, and where to read it

| Page | Endpoint |
| --- | --- |
| Events | `GET /api/runs`, `GET /api/runs/calendar?scope=own\|all` |
| An event | `GET /api/runs/[id]` |
| Stranded events | `GET /api/runs/stranded` |
| (no page) Components and contributed sets | `GET /api/components`, `GET /api/component-sets`, `GET /api/component-sets/[id]` |
| Cloud status | `GET /api/cloud-status` |
| Settings → org secrets / templates / repos | `GET /api/settings/org-secrets`, `GET /api/settings/templates[?status=1]`, `GET /api/settings/repos` |
| My Harness tokens | `GET /api/me/harness-tokens` |
| My org secrets / templates | `GET /api/me/org-secrets`, `GET /api/me/templates[?status=1]` |
| My settings (theme, calendar scope) | `GET`/`PATCH /api/me` |
| Users | `GET /api/users` |
| Admin settings (sign-in domains) | `GET /api/settings/domains` |
| eVals settings | `GET /api/evals/employees`, `GET /api/evals/hibob/sync`, `GET /api/evals/titles` |
| Labs | `GET /api/lab-workshops`, `GET /api/lab-workshops/[id or slug]`, `GET /api/lab-guides`, `GET /api/lab-guides/[id or slug]`, `GET /api/lab-images` |

Changes go through the same routes the pages call: `POST`, `PATCH` and `DELETE`
on the paths above. The e2e matrix in `roles.test.ts` lists every route along
with the role it needs.

Lab workshops and guides can be read without signing in. If an editor's token
is attached, the response also includes unpublished workshops and, for a guide,
the workshops that use it.
