/** Checks a proposed component set before it is stored. */

import {
  COMPONENT_KINDS,
  COMPONENT_SCOPES,
  type ComponentKind,
  type ComponentScope,
} from "@/db/schema";

const IDENTIFIER = /^[a-zA-Z_][0-9a-zA-Z_$]{0,127}$/;
const SECRET_IDENTIFIER = /^[a-zA-Z_][0-9a-zA-Z_$-]{0,127}$/;

const RESERVED = new Set([
  "or", "and", "eq", "ne", "lt", "gt", "le", "ge", "div", "mod", "not",
  "null", "true", "false", "new", "var", "return", "step", "parallel",
  "stepgroup", "org", "account", "status", "liteenginetask", "notification",
]);

export type ValidationIssue = {
  index: number;
  identifier: string | null;
  field: string;
  message: string;
};

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

const SPEC_FIELD: Record<ComponentKind, { field: string; hint: string }> = {
  secret_text: { field: "value", hint: "the secret's value, usually a ${binding}" },
  secret_file: { field: "content", hint: "the file's contents, usually a ${binding}" },
  connector: { field: "type", hint: "the Harness connector type, e.g. \"Gcp\"" },
  template: { field: "yaml", hint: "the template YAML, starting with \"template:\"" },
};

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
        `"${identifier}" is reserved by the Harness expression language, so ` +
          `pick another name.`,
      );
    }
  }

  const scope = COMPONENT_SCOPES.includes(c.scope as ComponentScope)
    ? (c.scope as ComponentScope)
    : null;
  if (!scope) {
    fail("scope", `must be one of ${COMPONENT_SCOPES.join(", ")}`);
  } else if (scope === "project") {
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

export const MAX_SET_COMPONENTS = 100;

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
