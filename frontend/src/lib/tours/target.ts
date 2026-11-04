/**
 * How a tour step finds the element it points at, again, on a page whose code
 * has moved on since the step was written.
 *
 * A target holds several ways of finding the element, tried strongest first:
 * a `data-tour` attribute someone added for the purpose, an id, the element's
 * role and accessible name, and last a structural path from the nearest
 * ancestor that has an id or a `data-tour`. A way that matches more than one
 * element is passed over, so a step never points at the wrong one of two; a
 * target none of whose ways finds exactly one element is not found, and the
 * player skips that step.
 *
 * Pure and DOM-free in its types, so the unit suite can drive it with a fake
 * tree; the browser passes `document`.
 */

import { z } from "zod";

/** A selector or name longer than this is not one a person picked. */
const MAX = 500;

export const tourTargetSchema = z.object({
  /** The value of a `data-tour` attribute. */
  tour: z.string().min(1).max(MAX).optional(),
  /** An id that React did not generate. */
  id: z.string().min(1).max(MAX).optional(),
  /** An ARIA role, implicit or explicit, and the accessible name to find among elements with it. */
  role: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(MAX).optional(),
  /** A CSS selector, from an anchored ancestor down by `nth-of-type`. */
  path: z.string().min(1).max(MAX).optional(),
  /** What the element said when it was picked, for the editor to name a step it can no longer find. */
  label: z.string().max(200).default(""),
});

export type TourTarget = z.infer<typeof tourTargetSchema>;

/** The least of an Element that resolving a target needs. */
export type TargetNode = {
  getAttribute(name: string): string | null;
  readonly textContent: string | null;
  readonly tagName: string;
};

export type TargetRoot = {
  querySelectorAll(selector: string): ArrayLike<TargetNode>;
};

/** The elements that carry each role without saying so. */
const IMPLICIT_ROLES: Record<string, string[]> = {
  button: ["button", "input[type=button]", "input[type=submit]", "summary"],
  link: ["a[href]"],
  heading: ["h1", "h2", "h3", "h4", "h5", "h6"],
  textbox: ["input:not([type])", "input[type=text]", "input[type=search]", "input[type=email]", "textarea"],
  checkbox: ["input[type=checkbox]"],
  combobox: ["select"],
  table: ["table"],
  navigation: ["nav"],
  main: ["main"],
};

/** An element's accessible name, near enough: its label attribute, else its text, collapsed and capped. */
export function nameOf(node: TargetNode): string {
  const label = node.getAttribute("aria-label") ?? node.getAttribute("title");
  const raw = label ?? node.textContent ?? "";
  return raw.replace(/\s+/g, " ").trim().slice(0, 80);
}

/** `"` and `\` escaped, for an attribute value inside double quotes. */
export function cssString(value: string): string {
  return `"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}

function selectorFor(role: string): string {
  return [`[role=${cssString(role)}]`, ...(IMPLICIT_ROLES[role] ?? [])].join(", ");
}

function only<T>(list: ArrayLike<T>): T | null {
  return list.length === 1 ? list[0]! : null;
}

function query(root: TargetRoot, selector: string): ArrayLike<TargetNode> {
  try {
    return root.querySelectorAll(selector);
  } catch {
    // A selector saved from a page whose ids the browser now reads differently.
    return [];
  }
}

/** The one element `target` names in `root`, or null when no way of finding it finds exactly one. */
export function resolveTarget<N extends TargetNode>(target: TourTarget, root: TargetRoot): N | null {
  const tries: (() => TargetNode | null)[] = [
    () => (target.tour ? only(query(root, `[data-tour=${cssString(target.tour)}]`)) : null),
    () => (target.id ? only(query(root, `[id=${cssString(target.id)}]`)) : null),
    () => {
      if (!target.role || !target.name) return null;
      const named = Array.from(query(root, selectorFor(target.role))).filter((n) => nameOf(n) === target.name);
      return only(named);
    },
    () => (target.path ? only(query(root, target.path)) : null),
  ];
  for (const attempt of tries) {
    const found = attempt();
    if (found) return found as N;
  }
  return null;
}
