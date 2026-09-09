/**
 * The blanks a guide can leave for its reader — `{{project}}` and friends — and
 * the cookie that remembers whose values belong in them.
 *
 * Filling happens on the server, in the Markdown tree rather than in the source
 * text, so a value lands as literal text wherever it appears: prose, a fenced
 * command the reader copies, or the href of a link. Nothing here reads the
 * database; `guide-values.ts` does that.
 */

import { isUuid } from "@/lib/utils";

export const GUIDE_VARIABLES = [
  {
    name: "project",
    label: "Harness project",
    hint: "The identifier of the project you were given, as it appears in its URL.",
    example: "shawn_pearson",
  },
  {
    name: "org",
    label: "Harness organization",
    hint: "The identifier of the event's organization.",
    example: "acme_summit",
  },
  {
    name: "account",
    label: "Harness account",
    hint: "The account identifier, the long string after /account/ in any Harness URL.",
    example: "wlgELJ0TTre5aZhzEfwsfw",
  },
  {
    name: "projectUrl",
    label: "Harness project link",
    hint: "The full address of your project's overview page.",
    example:
      "https://app.harness.io/ng/account/wlgELJ0TTre5aZhzEfwsfw/home/orgs/acme_summit/projects/shawn_pearson/details",
  },
  {
    name: "orgUrl",
    label: "Harness organization link",
    hint: "The full address of the event's organization.",
    example:
      "https://app.harness.io/ng/account/wlgELJ0TTre5aZhzEfwsfw/settings/organizations/acme_summit/details",
  },
  {
    name: "email",
    label: "Your email address",
    hint: "The account you signed in with.",
    example: "attendee14@example.com",
  },
  {
    name: "workshop",
    label: "Event name",
    hint: "What the event you are attending is called.",
    example: "Acme Summit — Platform Day",
  },
  {
    name: "gcpProject",
    label: "Google Cloud project",
    hint: "The Google Cloud project you were given.",
    example: "ws-acme-summit-14",
  },
  {
    name: "awsAccount",
    label: "AWS account",
    hint: "The number of the AWS account you were given.",
    example: "123456789012",
  },
  {
    name: "awsRegion",
    label: "AWS region",
    hint: "The region the event's AWS resources live in.",
    example: "us-east-1",
  },
] as const;

export type GuideVariableName = (typeof GUIDE_VARIABLES)[number]["name"];

export type GuideVariable = (typeof GUIDE_VARIABLES)[number];

export type GuideValues = Partial<Record<GuideVariableName, string>>;

const BY_NAME = new Map<string, GuideVariable>(
  GUIDE_VARIABLES.map((variable) => [variable.name, variable]),
);

export const isGuideVariable = (name: string): name is GuideVariableName =>
  BY_NAME.has(name);

export const guideVariable = (name: GuideVariableName): GuideVariable =>
  BY_NAME.get(name)!;

/** What a render found: which blanks a guide has, and which stayed blank. */
export type GuideVariableReport = {
  used: GuideVariableName[];
  missing: GuideVariableName[];
  unknown: string[];
};

type Tally = {
  used: Set<GuideVariableName>;
  missing: Set<GuideVariableName>;
  unknown: Set<string>;
};

export const newTally = (): Tally => ({
  used: new Set(),
  missing: new Set(),
  unknown: new Set(),
});

export const tallied = (tally: Tally): GuideVariableReport => ({
  used: [...tally.used],
  missing: [...tally.missing],
  unknown: [...tally.unknown],
});

const TOKEN = /\{\{\s*([A-Za-z][A-Za-z\d]*)\s*\}\}/g;

/**
 * Swaps every `{{name}}` this reader has a value for. A name nobody has filled
 * in yet — and a name that is not a variable at all, which is nearly always a
 * typo — is left standing, so the page shows what it is waiting for rather than
 * a hole where a project name should be.
 */
export function fillGuideVariables(
  text: string,
  values: GuideValues,
  tally?: Tally,
): string {
  if (!text.includes("{{")) return text;

  return text.replace(TOKEN, (token, name: string) => {
    if (!isGuideVariable(name)) {
      tally?.unknown.add(name);
      return token;
    }

    tally?.used.add(name);

    const value = values[name];
    if (value === undefined || value.length === 0) {
      tally?.missing.add(name);
      return token;
    }

    return value;
  });
}

/** Stand-in values, for showing an author what a filled guide reads like. */
export const exampleGuideValues = (): GuideValues =>
  Object.fromEntries(GUIDE_VARIABLES.map((v) => [v.name, v.example]));

export const GUIDE_CONTEXT_COOKIE = "guide-context";

/** Whose values to fill a guide with: an event account, hand-typed, or both. */
export type GuideContext = {
  runId: string | null;
  accountId: number | null;
  typed: GuideValues;
};

export const EMPTY_GUIDE_CONTEXT: GuideContext = {
  runId: null,
  accountId: null,
  typed: {},
};

/** Long enough for a project link, short enough to keep the cookie small. */
const MAX_VALUE = 300;

export function parseGuideContext(raw: string | undefined): GuideContext {
  if (!raw) return EMPTY_GUIDE_CONTEXT;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return EMPTY_GUIDE_CONTEXT;
  }
  if (parsed === null || typeof parsed !== "object") return EMPTY_GUIDE_CONTEXT;

  const { runId, accountId, typed } = parsed as Record<string, unknown>;

  return {
    runId: typeof runId === "string" && isUuid(runId) ? runId : null,
    accountId:
      typeof accountId === "number" && Number.isInteger(accountId) && accountId > 0
        ? accountId
        : null,
    typed: readTyped(typed),
  };
}

function readTyped(typed: unknown): GuideValues {
  if (typed === null || typeof typed !== "object") return {};

  const values: GuideValues = {};
  for (const [name, value] of Object.entries(typed as Record<string, unknown>)) {
    if (!isGuideVariable(name) || typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, MAX_VALUE);
    if (trimmed.length > 0) values[name] = trimmed;
  }
  return values;
}

const YEAR_SECONDS = 31_536_000;

/**
 * Written from the browser, the way the theme and sidebar cookies are: the
 * server only ever reads it, and it holds nothing an attendee cannot already
 * see on their own event page.
 */
export function writeGuideContextCookie(context: GuideContext): void {
  const value = encodeURIComponent(
    JSON.stringify({
      runId: context.runId,
      accountId: context.accountId,
      typed: readTyped(context.typed),
    }),
  );

  document.cookie = `${GUIDE_CONTEXT_COOKIE}=${value}; path=/; max-age=${YEAR_SECONDS}; samesite=lax`;
}

export function clearGuideContextCookie(): void {
  document.cookie = `${GUIDE_CONTEXT_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
