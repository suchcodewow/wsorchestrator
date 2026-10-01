import type { EndpointGroup } from "./types";

// Shared field list for a proposed component, used by validate, create and replace.
const componentFields = [
  {
    name: "components[]",
    type: "object[]",
    required: true,
    note: "1 to 100 components; identifiers must be unique within the set",
  },
  {
    name: "components[].identifier",
    type: "string",
    required: true,
    note: "Harness identifier: a letter or underscore, then letters, digits, underscores or $ (secrets may also use hyphens), up to 128 characters; not a Harness expression keyword such as org, status or true",
  },
  {
    name: "components[].kind",
    type: `"secret_text" | "secret_file" | "connector" | "template"`,
    required: true,
  },
  {
    name: "components[].scope",
    type: `"org"`,
    required: true,
    note: `"project" is a known value but is rejected as not supported yet`,
  },
  {
    name: "components[].name",
    type: "string",
    required: true,
    note: "non-empty; what appears in the Harness console",
  },
  { name: "components[].description", type: "string", note: `defaults to ""` },
  {
    name: "components[].spec",
    type: "object",
    required: true,
    note: "must carry a non-empty string per kind: secret_text spec.value, secret_file spec.content, connector spec.type, template spec.yaml (whose first line is template:)",
  },
  {
    name: "components[].requires",
    type: "string[]",
    note: `binding paths such as "outputs.foo"; defaults to []`,
  },
  {
    name: "components[].dependsOn",
    type: "string[]",
    note: "identifiers of other components; defaults to []",
  },
  { name: "components[].versionLabel", type: "string", note: `defaults to "1"` },
];

const idParam = [{ name: "id", type: "string (uuid)", required: true }];

export const CONTENT_GROUPS: EndpointGroup[] = [
  {
    id: "components",
    title: "Components",
    intro:
      "Components are the Harness secrets, connectors and templates created in every workshop's organization. A component set is a contributor's candidate set of Harness components: it is tested in a sandbox run, submitted, and then published into every workshop by an Event Manager. A set moves testing → submitted → approved or rejected.",
    endpoints: [
      {
        method: "GET",
        path: "/api/components",
        summary: "Lists the published components every workshop gets.",
        access: "contributor",
        token: true,
        notes:
          "`dependsOn` is worked out, not just stored: it adds any other published component the spec mentions as `org.<identifier>`. `usedBy` is the reverse.",
        returns:
          "{ components: { identifier, kind, scope, name, description, spec, requires: string[], dependsOn: string[], usedBy: string[], versionLabel, builtin: boolean }[] }",
      },
      {
        method: "POST",
        path: "/api/components/validate",
        summary: "Checks a proposed set of components without storing anything.",
        access: "contributor",
        token: true,
        notes:
          "Per-component checks only. Dependency cycles and references to components that do not exist are checked by the runner when a sandbox run starts. Problems come back with status 200 and `ok: false`.",
        body: { kind: "json", fields: componentFields },
        returns:
          "{ ok: boolean, checked: number, accepted: number, issues: { index, identifier: string | null, field, message }[], note: string }",
        errors: [{ status: 400, error: "invalid_body", when: "the body is not JSON" }],
      },
      {
        method: "GET",
        path: "/api/component-sets",
        summary: "Lists component sets, oldest change first.",
        access: "contributor",
        token: true,
        notes:
          "An Event Manager sees every set. Anyone else sees only the sets they wrote.",
        query: [
          {
            name: "status",
            type: `"testing" | "submitted" | "approved" | "rejected"`,
            note: "filters by status; any other value returns an empty list",
          },
        ],
        returns:
          "{ sets: { id, name, status, notes, authorId, updatedAt, componentCount: number, runCount: number }[] }",
      },
      {
        method: "POST",
        path: "/api/component-sets",
        summary: "Creates a component set and, unless told not to, starts a sandbox run to test it.",
        access: "contributor",
        token: true,
        notes:
          "The set starts as `testing`. The sandbox run is a real Harness-only event owned by you: \"Sandbox — {name}\", one user, no clouds, torn down after 2 hours. It is started at once; `started: false` means the immediate start failed and the scheduler will pick it up.",
        body: {
          kind: "json",
          fields: [
            {
              name: "name",
              type: "string",
              required: true,
              note: "non-empty; trimmed and cut to 200 characters",
            },
            ...componentFields,
            { name: "test", type: "boolean", note: "false creates the set without a sandbox run" },
          ],
        },
        returns: "201 { setId: string, run: Run | null, started: boolean }",
        errors: [
          { status: 400, error: "invalid_body", when: "the body is not JSON or has no name" },
          { status: 422, error: "invalid_components", when: "any component fails validation; `issues` lists why" },
        ],
      },
      {
        method: "GET",
        path: "/api/component-sets/{id}",
        summary: "Reads one component set and the components it proposes.",
        access: "contributor",
        token: true,
        notes:
          "Only the set's author or an Event Manager can read it; anyone else gets 404.",
        params: idParam,
        returns:
          "{ set: { id, name, status, authorId, notes, createdAt, updatedAt }, components: { identifier, kind, scope, name, description, spec, requires, dependsOn, versionLabel, builtin }[] }",
        errors: [{ status: 404, error: "not_found", when: "no such set, or it is not yours" }],
      },
      {
        method: "PUT",
        path: "/api/component-sets/{id}",
        summary: "Replaces every component in a set.",
        access: "contributor",
        token: true,
        notes:
          "Only the set's author or an Event Manager. The set must still be `testing`. Earlier sandbox runs keep their link to the set but tested the old components.",
        params: idParam,
        body: { kind: "json", fields: componentFields },
        returns: "{ setId: string, components: number }",
        errors: [
          { status: 400, error: "invalid_body", when: "the body is not JSON" },
          { status: 404, error: "not_found", when: "no such set, or it is not yours" },
          { status: 409, error: "not_editable", when: "the set is not `testing`" },
          { status: 422, error: "invalid_components", when: "any component fails validation; `issues` lists why" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/component-sets/{id}",
        summary: "Withdraws a submitted set back to testing.",
        access: "signedIn",
        token: true,
        notes:
          "Despite the method, nothing is deleted: the set moves from `submitted` back to `testing`. Only the set's author or an Event Manager. Unlike the other set routes, this one does not require the Event Contributor role.",
        params: idParam,
        returns: `{ setId: string, status: "testing" }`,
        errors: [
          { status: 404, error: "not_found", when: "no such set, or it is not yours" },
          { status: 409, error: "not_withdrawable", when: "the set is not `submitted`" },
        ],
      },
      {
        method: "POST",
        path: "/api/component-sets/{id}/submit",
        summary: "Offers a tested set for review.",
        access: "contributor",
        token: true,
        notes:
          "Only the set's author, an Event Manager included. A set with no sandbox runs can still be submitted; `untested` says so.",
        params: idParam,
        body: {
          kind: "json",
          fields: [{ name: "notes", type: "string", note: "for the reviewer; cut to 2,000 characters" }],
        },
        returns:
          `{ setId: string, status: "submitted", testedBy: { id, status }[], untested: boolean }`,
        errors: [
          { status: 404, error: "not_found", when: "no such set, or you did not write it" },
          { status: 409, error: "not_submittable", when: "the set is not `testing`" },
        ],
      },
      {
        method: "POST",
        path: "/api/component-sets/{id}/approve",
        summary: "Publishes a submitted set, or sends it back.",
        access: "manager",
        token: true,
        notes:
          "Approving copies every component into the published catalog, so every workshop provisioned from then on gets it. A component whose identifier is already published replaces that one, built-in components included. Only `approve: false` rejects; leaving it out approves. A reviewer may approve their own set.",
        params: idParam,
        body: {
          kind: "json",
          fields: [
            { name: "approve", type: "boolean", note: "false rejects; anything else approves" },
            { name: "notes", type: "string", note: "review notes; cut to 2,000 characters" },
          ],
        },
        returns: `{ setId: string, status: "approved" | "rejected" }`,
        errors: [
          { status: 409, error: "not_reviewable", when: "the set is not `submitted`, or does not exist" },
        ],
      },
    ],
  },
  {
    id: "lab-guides",
    title: "Lab guides",
    intro:
      "A lab guide is one Markdown page an attendee follows. A guide has `id`, `slug`, `title`, `summary`, `body` (Markdown), `authorId`, `createdAt` and `updatedAt`; reads also add `authorName`. The slug comes from the title.",
    endpoints: [
      {
        method: "GET",
        path: "/api/lab-guides",
        summary: "Lists every lab guide, most recently changed first.",
        access: "public",
        token: true,
        returns: "{ guides: { id, slug, title, summary, updatedAt, authorName }[] }",
      },
      {
        method: "POST",
        path: "/api/lab-guides",
        summary: "Writes a new lab guide.",
        access: "manager",
        token: true,
        notes:
          "The slug is made from the title (up to 40 characters). If it is taken, -2, -3 and so on is added; \"new\" and \"edit\" become \"new-guide\" and \"edit-guide\".",
        body: {
          kind: "json",
          fields: [
            { name: "title", type: "string", required: true, note: "trimmed; 1 to 200 characters" },
            { name: "summary", type: "string", note: `trimmed; up to 300 characters; defaults to ""` },
            { name: "body", type: "string", note: `Markdown; up to 200,000 characters; defaults to ""` },
          ],
        },
        returns: "201 { guide: Guide }",
        errors: [{ status: 400, error: "invalid_body", when: "the body fails validation" }],
      },
      {
        method: "GET",
        path: "/api/lab-guides/{id}",
        summary: "Reads one lab guide with its Markdown.",
        access: "public",
        token: true,
        notes:
          "Accepts an id or a slug. An Event Manager also gets `usedIn`, the workshops that include the guide, unpublished ones too; for anyone else the field is absent.",
        params: [{ name: "id", type: "string", required: true, note: "the guide's id or slug" }],
        returns: "{ guide: Guide & { authorName }, usedIn?: { slug, title }[] }",
        errors: [{ status: 404, error: "not_found", when: "no guide has that id or slug" }],
      },
      {
        method: "PATCH",
        path: "/api/lab-guides/{id}",
        summary: "Rewrites a lab guide.",
        access: "manager",
        token: true,
        notes:
          "This replaces the guide: a `summary` or `body` left out becomes empty. Changing the title changes the slug, so links to the old slug stop working. Takes an id only, not a slug.",
        params: idParam,
        body: {
          kind: "json",
          fields: [
            { name: "title", type: "string", required: true, note: "trimmed; 1 to 200 characters" },
            { name: "summary", type: "string", note: `trimmed; up to 300 characters; defaults to ""` },
            { name: "body", type: "string", note: `Markdown; up to 200,000 characters; defaults to ""` },
          ],
        },
        returns: "{ guide: Guide }",
        errors: [
          { status: 400, error: "invalid_body", when: "the body fails validation" },
          { status: 404, error: "not_found", when: "no guide has that id" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/lab-guides/{id}",
        summary: "Deletes a lab guide.",
        access: "manager",
        token: true,
        notes:
          "Irreversible. The guide is also removed from every workshop that included it, without warning. Takes an id only.",
        params: idParam,
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "no guide has that id" }],
      },
      {
        method: "GET",
        path: "/api/lab-guides/{id}/preview",
        summary: "Renders a stored guide to HTML for the workshop editor's preview.",
        access: "manager",
        token: true,
        notes: "Takes an id only. Variables such as `{{project}}` are left unfilled.",
        params: idParam,
        returns: "{ slug, title, summary, html: string }",
        errors: [{ status: 404, error: "not_found", when: "no guide has that id" }],
      },
      {
        method: "POST",
        path: "/api/lab-guides/preview",
        summary: "Renders a draft guide body to HTML without saving it.",
        access: "manager",
        token: true,
        notes:
          "The HTML carries source-line markers for the editor, and images missing from the library are ringed in red. Variables are left unfilled; `variables` reports which ones the body uses.",
        body: {
          kind: "json",
          fields: [{ name: "body", type: "string", required: true, note: "Markdown; up to 200,000 characters" }],
        },
        returns: "{ html: string, variables: { used: string[], missing: string[], unknown: string[] } }",
        errors: [{ status: 400, error: "invalid_body", when: "the body fails validation" }],
      },
      {
        method: "POST",
        path: "/api/lab-guides/image-refs",
        summary: "Lists the lab images a draft body points at that the library no longer holds.",
        access: "manager",
        token: true,
        notes: "Cheaper than a preview: it parses the body and does one lookup.",
        body: {
          kind: "json",
          fields: [{ name: "body", type: "string", required: true, note: "Markdown; up to 200,000 characters" }],
        },
        returns: "{ missing: { id: string, alt: string }[] }",
        errors: [{ status: 400, error: "invalid_body", when: "the body fails validation" }],
      },
    ],
  },
  {
    id: "lab-images",
    title: "Lab images",
    intro:
      "The picture library lab guides embed. An image is `{ id, name, alt, mimeType, bytes, authorId, createdAt }`; its bytes are served separately.",
    endpoints: [
      {
        method: "GET",
        path: "/api/lab-images",
        summary: "Lists the image library, newest first.",
        access: "manager",
        token: true,
        query: [{ name: "q", type: "string", note: "case-insensitive match anywhere in the name" }],
        returns: "{ images: Image[] }",
        errors: [
          { status: 503, error: "not_migrated", when: "the lab_images table is missing" },
          { status: 500, error: "unavailable", when: "the library could not be read" },
        ],
      },
      {
        method: "POST",
        path: "/api/lab-images",
        summary: "Uploads an image into the library.",
        access: "manager",
        token: true,
        notes:
          "The type is read from the file's bytes, not its declared type: PNG, JPEG, GIF or WebP only. The browser picker downscales to 2,000 px wide first; the API stores what it gets.",
        body: {
          kind: "multipart",
          fields: [
            { name: "file", type: "file", required: true, note: "PNG, JPEG, GIF or WebP; at most 5 MB" },
            { name: "name", type: "string", note: `defaults to the file name, then "Untitled image"; cut to 200 characters` },
            { name: "alt", type: "string", note: "defaults to the name; cut to 300 characters" },
            { name: "autoName", type: `"1"`, note: `adds " 2", " 3"… when the name is already taken` },
          ],
        },
        returns: "201 { image: Image }",
        errors: [
          { status: 400, error: "invalid_body", when: "the body is not multipart, or has no file" },
          { status: 400, error: "empty", when: "the file is empty" },
          { status: 413, error: "too_large", when: "the file is over 5 MB" },
          { status: 415, error: "unsupported_type", when: "the bytes are not PNG, JPEG, GIF or WebP" },
        ],
      },
      {
        method: "GET",
        path: "/api/lab-images/{id}",
        summary: "Serves an image's bytes.",
        access: "public",
        token: true,
        notes:
          "Sent inline with its stored Content-Type and cached as immutable for a year, so a deleted image can linger in caches.",
        params: idParam,
        returns: "the image bytes",
        errors: [{ status: 404, error: "not_found", when: "no image has that id" }],
      },
      {
        method: "PATCH",
        path: "/api/lab-images/{id}",
        summary: "Renames an image.",
        access: "manager",
        token: true,
        notes: "The alt text is overwritten with the new name too.",
        params: idParam,
        body: {
          kind: "json",
          fields: [{ name: "name", type: "string", required: true, note: "non-empty; trimmed and cut to 200 characters" }],
        },
        returns: "{ image: Image }",
        errors: [
          { status: 400, error: "invalid_body", when: "no non-empty name" },
          { status: 404, error: "not_found", when: "no image has that id" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/lab-images/{id}",
        summary: "Deletes an image.",
        access: "manager",
        token: true,
        notes:
          "Irreversible. Guides that embed it are not changed and point at nothing; POST /api/lab-guides/image-refs finds them.",
        params: idParam,
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "no image has that id" }],
      },
    ],
  },
  {
    id: "lab-workshops",
    title: "Lab workshops",
    intro:
      "A lab workshop is an ordered list of lab guides, up to 50. A workshop has `id`, `slug`, `title`, `summary`, `published`, `authorId`, `createdAt` and `updatedAt`. Only published workshops are visible to the public.",
    endpoints: [
      {
        method: "GET",
        path: "/api/lab-workshops",
        summary: "Lists workshops, most recently changed first.",
        access: "public",
        token: true,
        notes: "An Event Manager also sees unpublished workshops; anyone else sees published ones only.",
        returns:
          "{ workshops: { id, slug, title, summary, published, updatedAt, authorName, guideCount: number }[] }",
      },
      {
        method: "POST",
        path: "/api/lab-workshops",
        summary: "Creates a workshop.",
        access: "manager",
        token: true,
        notes:
          "The slug is made from the title (up to 40 characters). If it is taken, -2, -3 and so on is added; \"new\" and \"guides\" become \"new-workshop\" and \"guides-workshop\".",
        body: {
          kind: "json",
          fields: [
            { name: "title", type: "string", required: true, note: "trimmed; 1 to 200 characters" },
            { name: "summary", type: "string", note: `trimmed; up to 300 characters; defaults to ""` },
            { name: "published", type: "boolean", note: "defaults to false" },
            { name: "guideIds", type: "string[] (uuid)", note: "the contents in order; up to 50; repeats are dropped; defaults to []" },
          ],
        },
        returns: "201 { workshop: Workshop }",
        errors: [
          { status: 400, error: "invalid_body", when: "the body fails validation" },
          { status: 400, error: "unknown_guide", when: "a guide id does not exist" },
        ],
      },
      {
        method: "GET",
        path: "/api/lab-workshops/{id}",
        summary: "Reads one workshop with its guides in order.",
        access: "public",
        token: true,
        notes: "Accepts an id or a slug. An unpublished workshop is found only by an Event Manager; anyone else gets 404.",
        params: [{ name: "id", type: "string", required: true, note: "the workshop's id or slug" }],
        returns: "{ workshop: Workshop & { authorName, guides: { id, slug, title, summary }[] } }",
        errors: [{ status: 404, error: "not_found", when: "no such workshop, or it is unpublished and you are not an editor" }],
      },
      {
        method: "PATCH",
        path: "/api/lab-workshops/{id}",
        summary: "Rewrites a workshop and its contents.",
        access: "manager",
        token: true,
        notes:
          "This replaces the workshop: a field left out takes its default, so leaving out `published` unpublishes it and leaving out `guideIds` empties it. The slug follows the title only while the workshop is unpublished. Takes an id only.",
        params: idParam,
        body: {
          kind: "json",
          fields: [
            { name: "title", type: "string", required: true, note: "trimmed; 1 to 200 characters" },
            { name: "summary", type: "string", note: `trimmed; up to 300 characters; defaults to ""` },
            { name: "published", type: "boolean", note: "defaults to false" },
            { name: "guideIds", type: "string[] (uuid)", note: "the full contents in order; up to 50; repeats are dropped; defaults to []" },
          ],
        },
        returns: "{ workshop: Workshop }",
        errors: [
          { status: 400, error: "invalid_body", when: "the body fails validation" },
          { status: 404, error: "not_found", when: "no workshop has that id" },
          { status: 400, error: "unknown_guide", when: "a guide id does not exist" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/lab-workshops/{id}",
        summary: "Deletes a workshop.",
        access: "manager",
        token: true,
        notes: "Irreversible. Its guides are kept.",
        params: idParam,
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "no workshop has that id" }],
      },
      {
        method: "POST",
        path: "/api/lab-workshops/{id}/guides",
        summary: "Adds one guide to the end of a workshop.",
        access: "manager",
        token: true,
        notes: "A guide already in the workshop stays where it is, and the call still succeeds.",
        params: idParam,
        body: {
          kind: "json",
          fields: [{ name: "guideId", type: "string (uuid)", required: true }],
        },
        returns: "{ ok: true, slug: string }",
        errors: [
          { status: 400, error: "invalid_body", when: "guideId is missing or not a uuid" },
          { status: 404, error: "not_found", when: "no workshop has that id" },
          { status: 400, error: "unknown_guide", when: "no guide has that id" },
          { status: 409, error: "full", when: "the workshop already has 50 guides" },
        ],
      },
    ],
  },
];
