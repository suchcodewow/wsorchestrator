# Temporary probes

These are experiments to find out how the app could sign a learner in when it is
opened inside Mindtickle. None of them signs anyone in. Each one is meant to be
deleted outright once it has answered its question, or once that route turns
out to be a dead end. Every file listed here starts with a `TEMPORARY PROBE`
comment, so `git grep -l "TEMPORARY PROBE"` finds them all.

To delete a probe, remove everything in its section in one change. Then run
`npm run verify` and `npm run build && npm run test:e2e` in `frontend/`: the
api-reference test and the e2e matrix fail on any route that was left half
removed.

## LTI 1.3 launch

**Question:** can Mindtickle act as an LTI 1.3 platform, and what does its
signed id_token say about the learner?

It is blocked on Mindtickle. Nothing in its UI registers an LTI tool, so we need
an issuer, client id, deployment id, OIDC auth URL and JWKS URL from Mindtickle
support. When those settings are missing, both routes answer 503.

| Delete                                                    | What it is                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `frontend/src/lib/lti.ts`                                 | Login state, the authorization redirect, id_token verification     |
| `frontend/src/lib/lti-page.ts`                            | The HTML page the launch answers with                              |
| `frontend/src/app/api/lti/`                               | `login` and `launch` routes                                        |
| `frontend/test/unit/lti.test.ts`                          | Its unit tests                                                     |
| The `"lti"` group in `frontend/src/lib/api-reference/admin.ts`, and `"lti"` in `index.ts` | Its API reference entries |
| The three `/api/lti/*` rows in `frontend/test/e2e/roles.test.ts` | Its e2e matrix rows                                         |
| The `lti_*` variables in `infra/admin/variables.tf`, and the `var.lti_client_id` block in `infra/admin/app.tf` | Its environment settings |
| Any `lti_*` value set on the Harness workspaces (`qa_control_plane`, production) | Its configuration, wherever someone set it |
| The "Mindtickle LTI launch" row in `docs/environments.md` | Its documentation                                                  |

The LTI launch is the only route with a form body, so `"form"` in the body kind
in `frontend/src/lib/api-reference/types.ts`, and its label in
`frontend/src/app/api/page.tsx`, can go with it. Both are harmless if left.

## SCORM probe

**Question:** a SCORM package uploaded to Mindtickle can frame the app. What
can the framed app learn there?

- the shell's origin, and the learner id and name that Mindtickle's SCORM API
  gives (this identity is unsigned)
- which cookies survive in the frame: `Lax`, `None`, or `None; Partitioned`
- whether the app's session is visible there
- whether the Storage Access API is available
- whether a popup can open and report back, as a popup sign-in would need to
- whether a completion reaches Mindtickle

To run it, download the package from `/scorm-probe` (outside a frame) or from
`/api/scorm-probe/package` on the environment to test. Upload the zip to
Mindtickle as SCORM content and open it as a learner. **Copy report** gathers
everything the page shows.

**Found so far:** in Chrome inside Mindtickle, `Lax` cookies are dropped,
`None` and `Partitioned` ones are kept, and a popup opens and sees the app's
session. The frame sign-in (`frontend/src/lib/frame-cookie.ts`) is built on
that finding and is permanent; deleting the probe leaves it in place.

| Delete                                                        | What it is                                          |
| ------------------------------------------------------------- | --------------------------------------------------- |
| `frontend/src/lib/scorm-probe.ts`                             | The manifest and the shell                          |
| `frontend/src/app/scorm-probe/`                               | The page the shell frames                           |
| `frontend/src/app/api/scorm-probe/`                           | `package` and `cookies` routes                      |
| `frontend/test/unit/scorm-probe.test.ts`                      | Its unit tests                                      |
| The `"scorm-probe"` group in `frontend/src/lib/api-reference/admin.ts`, and `"scorm-probe"` in `index.ts` | Its API reference entries |
| The `/scorm-probe` page row and the two `/api/scorm-probe/*` rows in `frontend/test/e2e/roles.test.ts` | Its e2e matrix rows |
| The SCORM package uploaded to Mindtickle                      | Delete it there too                                 |

The probe moved the ZIP writer from `frontend/test/support/zip.ts` to
`frontend/src/lib/zip.ts`, so that the package route could use it. With the probe
gone, only the spreadsheet tests use it, so it can go back to `test/support/`. It
is also fine to leave it where it is.

## postMessage identity probe

**Question:** does Mindtickle post the learner's identity to a page it frames,
and does it answer any message that page sends up?

| Delete                                                      | What it is          |
| ----------------------------------------------------------- | ------------------- |
| `frontend/src/app/mindtickle-test/`                         | The page            |
| The `/mindtickle-test` page row in `frontend/test/e2e/roles.test.ts` | Its e2e matrix row |
