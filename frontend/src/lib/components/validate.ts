import {
  COMPONENT_KINDS,
  COMPONENT_SCOPES,
  type ComponentKind,
  type ComponentScope,
} from "@/db/schema";

/**
 * Checking a proposed component before it is stored or deployed.
 *
 * This is deliberately the *cheap* half of validation: everything decidable
 * from one component on its own, with no database read and no graph. Identifier
 * legality, a known kind and scope, a spec of the right shape for that kind.
 *
 * The other half — cycles, dangling `org.` references, a dependency order that
 * cannot be satisfied — needs the whole catalog and lives in the runner, which
 * is the thing that actually applies it. That split is on purpose. The runner
 * is a Cloud Run *job*, invoked with environment overrides rather than called,
 * so the portal cannot ask it a question and wait for the answer; and putting a
 * second topological sort here to get around that would mean two
 * implementations of the ordering rules, which is exactly the situation where
 * "it validated" stops meaning "it will apply". So the portal answers what it
 * can answer alone, instantly, and the graph is checked by the code that
 * depends on it, at the start of the sandbox run the contributor is watching.
 *
 * Pure and synchronous, so the same function guards the validate endpoint, the
 * candidate-set create, and the plain-bundle upload without any of them
 * restating the rules.
 */

/**
 * A legal Harness identifier: a letter or underscore, then letters, digits,
 * underscores, or dollars, up to 128 characters.
 *
 * Secrets are the exception — Harness allows hyphens there and nowhere else —
 * which is worth encoding rather than flattening to the stricter rule, because
 * a contributor rejected for a hyphen Harness would have accepted has been told
 * something untrue.
 */
const IDENTIFIER = /^[a-zA-Z_][0-9a-zA-Z_$]{0,127}$/;
const SECRET_IDENTIFIER = /^[a-zA-Z_][0-9a-zA-Z_$-]{0,127}$/;

/**
 * Identifiers Harness reserves for its expression language. Legal syntax, but
 * rejected by the platform — so catching them here turns a confusing API error
 * during a sandbox run into a sentence the contributor can act on.
 */
const RESERVED = new Set([
  "or", "and", "eq", "ne", "lt", "gt", "le", "ge", "div", "mod", "not",
  "null", "true", "false", "new", "var", "return", "step", "parallel",
  "stepgroup", "org", "account", "status", "liteenginetask", "notification",
]);

/** One thing wrong with one component, addressed to whoever wrote it. */
export type ValidationIssue = {
  /** Index in the submitted list, so the caller can point at the right file. */
  index: number;
  /** The component's identifier, when it had a usable one. */
  identifier: string | null;
  /** Which field is at fault, for a form or an editor to highlight. */
  field: string;
  message: string;
};

/** A component as submitted: unvalidated, straight off the wire. */
export type SubmittedComponent = {
  identifier?: unknown;
  kind?: unknown;
  scope?: unknown;
  name?: unknown;
  description?: unknown;
  spec?: unknown;
  requires?: unknown;
  dependsOn?: unknown;
  versionLabel?: unknown;
};

/** A component that passed: every field present and of the right type. */
export type ValidComponent = {
  identifier: string;
  kind: ComponentKind;
  scope: ComponentScope;
  name: string;
  description: string;
  spec: Record<string, unknown>;
  requires: string[];
  dependsOn: string[];
  versionLabel: string;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * What each kind requires in `spec`, and the message for when it is missing.
 *
 * Only the field the runner actually reads is checked. A connector's inner
 * `spec` is Harness's business and is not second-guessed here — getting that
 * wrong is what the sandbox run is for, and a portal that pretended to know
 * every connector type's schema would be wrong the week Harness added one.
 */
const SPEC_FIELD: Record<ComponentKind, { field: string; hint: string }> = {
  secret_text: { field: "value", hint: "the secret's value, usually a ${binding}" },
  secret_file: { field: "content", hint: "the file's contents, usually a ${binding}" },
  connector: { field: "type", hint: "the Harness connector type, e.g. \"Gcp\"" },
  template: { field: "yaml", hint: "the template YAML, starting with \"template:\"" },
};

/**
 * Check one component. Returns every problem with it rather than the first, so
 * a contributor fixes a file once instead of round-tripping per mistake.
 */
export function validateComponent(
  c: SubmittedComponent,
  index: number,
): { issues: ValidationIssue[]; valid: ValidComponent | null } {
  const issues: ValidationIssue[] = [];
  const identifier = typeof c.identifier === "string" ? c.identifier : null;
  const fail = (field: string, message: string) =>
    issues.push({ index, identifier, field, message });

  const kind = COMPONENT_KINDS.includes(c.kind as ComponentKind)
    ? (c.kind as ComponentKind)
    : null;
  if (!kind) {
    fail("kind", `must be one of ${COMPONENT_KINDS.join(", ")}`);
  }

  if (identifier === null || identifier.length === 0) {
    fail("identifier", "is required");
  } else {
    // Secrets are the one kind that may contain a hyphen.
    const pattern =
      kind === "secret_text" || kind === "secret_file"
        ? SECRET_IDENTIFIER
        : IDENTIFIER;
    if (!pattern.test(identifier)) {
      fail(
        "identifier",
        `"${identifier}" is not a legal Harness identifier: start with a letter ` +
          `or underscore, then letters, digits, underscores${
            pattern === SECRET_IDENTIFIER ? ", hyphens," : ""
          } or dollars, up to 128 characters`,
      );
    } else if (RESERVED.has(identifier.toLowerCase())) {
      fail(
        "identifier",
        `"${identifier}" is reserved by the Harness expression language — ` +
          `Harness will reject it. Pick another name.`,
      );
    }
  }

  const scope = COMPONENT_SCOPES.includes(c.scope as ComponentScope)
    ? (c.scope as ComponentScope)
    : null;
  if (!scope) {
    fail("scope", `must be one of ${COMPONENT_SCOPES.join(", ")}`);
  } else if (scope === "project") {
    // Declared in the schema, not yet applied by the runner. Saying so plainly
    // beats accepting it and having the run fail with the same sentence later.
    fail("scope", "project scope is not supported yet — use org");
  }

  if (typeof c.name !== "string" || c.name.trim().length === 0) {
    fail("name", "is required — it is what appears in the Harness console");
  }

  if (!isRecord(c.spec)) {
    fail("spec", "must be an object");
  } else if (kind) {
    const { field, hint } = SPEC_FIELD[kind];
    const value = c.spec[field];
    if (typeof value !== "string" || value.length === 0) {
      fail(`spec.${field}`, `a ${kind} needs spec.${field} — ${hint}`);
    } else if (kind === "template" && value.trimStart().split("\n")[0]?.trim() !== "template:") {
      fail(
        "spec.yaml",
        'a template\'s YAML must start with "template:" — the runner fills in ' +
          "name, identifier, versionLabel, and orgIdentifier itself",
      );
    }
  }

  if (c.requires !== undefined && !isStringArray(c.requires)) {
    fail("requires", "must be an array of binding paths, e.g. [\"outputs.foo\"]");
  }
  if (c.dependsOn !== undefined && !isStringArray(c.dependsOn)) {
    fail("dependsOn", "must be an array of component identifiers");
  }
  if (c.versionLabel !== undefined && typeof c.versionLabel !== "string") {
    fail("versionLabel", "must be a string");
  }

  if (issues.length > 0) return { issues, valid: null };

  return {
    issues,
    valid: {
      identifier: identifier!,
      kind: kind!,
      scope: scope!,
      name: (c.name as string).trim(),
      description: typeof c.description === "string" ? c.description : "",
      spec: c.spec as Record<string, unknown>,
      requires: isStringArray(c.requires) ? c.requires : [],
      dependsOn: isStringArray(c.dependsOn) ? c.dependsOn : [],
      versionLabel:
        typeof c.versionLabel === "string" && c.versionLabel.length > 0
          ? c.versionLabel
          : "1",
    },
  };
}

/** How many components one candidate set may carry. A guard, not a target. */
export const MAX_SET_COMPONENTS = 100;

/**
 * Check a whole submitted set.
 *
 * Duplicate identifiers are caught here rather than left to the unique index:
 * two files proposing the same component is a mistake worth naming, and the
 * database error for it says nothing about which two.
 */
export function validateSet(components: unknown): {
  issues: ValidationIssue[];
  valid: ValidComponent[];
} {
  if (!Array.isArray(components)) {
    return {
      issues: [
        { index: -1, identifier: null, field: "components", message: "must be an array" },
      ],
      valid: [],
    };
  }
  if (components.length === 0) {
    return {
      issues: [
        { index: -1, identifier: null, field: "components", message: "is empty" },
      ],
      valid: [],
    };
  }
  if (components.length > MAX_SET_COMPONENTS) {
    return {
      issues: [
        {
          index: -1,
          identifier: null,
          field: "components",
          message: `at most ${MAX_SET_COMPONENTS} components per set`,
        },
      ],
      valid: [],
    };
  }

  const issues: ValidationIssue[] = [];
  const valid: ValidComponent[] = [];
  const seen = new Map<string, number>();

  components.forEach((raw, index) => {
    const result = validateComponent((raw ?? {}) as SubmittedComponent, index);
    issues.push(...result.issues);
    if (!result.valid) return;

    const first = seen.get(result.valid.identifier);
    if (first !== undefined) {
      issues.push({
        index,
        identifier: result.valid.identifier,
        field: "identifier",
        message: `duplicates the component at position ${first} — an identifier names one thing`,
      });
      return;
    }
    seen.set(result.valid.identifier, index);
    valid.push(result.valid);
  });

  return { issues, valid };
}
