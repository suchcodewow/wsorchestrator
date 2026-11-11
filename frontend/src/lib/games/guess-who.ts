/**
 * Guess Who, SDLC edition: the shape of its setup, and the default board.
 * The game knows only the tool cards' names and which tool is each round's
 * mystery; what each tool is, and where it sits, is for the room to work out
 * and the facilitator to answer. The facilitator's setup is saved with
 * `PUT /api/games/guess-who`; until someone saves one, `DEFAULT_GUESS_WHO` is
 * the board. Safe to import in the browser: the game itself runs there.
 */

import { z } from "zod";

export const TEAMS = ["red", "blue"] as const;
export type Team = (typeof TEAMS)[number];

export const GUESS_WHO_LIMITS = {
  toolsMin: 4,
  toolsMax: 30,
  roundsMax: 10,
  nameMax: 40,
  capMin: 3,
  capMax: 30,
} as const;

export const guessWhoToolSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(GUESS_WHO_LIMITS.nameMax),
});

export type GuessWhoTool = z.infer<typeof guessWhoToolSchema>;

export const guessWhoConfigSchema = z
  .object({
    tools: z.array(guessWhoToolSchema).min(GUESS_WHO_LIMITS.toolsMin).max(GUESS_WHO_LIMITS.toolsMax),
    rounds: z
      .array(z.object({ red: z.string(), blue: z.string() }))
      .min(1)
      .max(GUESS_WHO_LIMITS.roundsMax),
    /** A team that reaches this many questions without solving its board scores it and is shown the answer. */
    questionCap: z.number().int().min(GUESS_WHO_LIMITS.capMin).max(GUESS_WHO_LIMITS.capMax),
  })
  .superRefine((config, ctx) => {
    const ids = new Set<string>();
    config.tools.forEach((t, i) => {
      if (ids.has(t.id)) ctx.addIssue({ code: "custom", path: ["tools", i, "id"], message: "duplicate_tool" });
      ids.add(t.id);
    });
    config.rounds.forEach((r, i) => {
      if (!ids.has(r.red)) ctx.addIssue({ code: "custom", path: ["rounds", i, "red"], message: "unknown_tool" });
      if (!ids.has(r.blue)) ctx.addIssue({ code: "custom", path: ["rounds", i, "blue"], message: "unknown_tool" });
    });
  });

export type GuessWhoConfig = z.infer<typeof guessWhoConfigSchema>;

/**
 * The logos that ship with the app, in `public/games/guess-who/logos/`, by tool
 * id: 256×256, transparent, the mark trimmed and centered with equal padding.
 * A card whose id is not here shows its initials instead. A replaced logo gets
 * a new file name, so no browser or image cache serves the old one.
 */
const BUNDLED_LOGOS: Record<string, string> = {
  "argo-cd": "argo-cd.png",
  // Azure's own mark, rather than Azure DevOps's.
  "azure-devops": "azure.png",
  bitbucket: "bitbucket.png",
  checkmarx: "checkmarx.png",
  circleci: "circleci.png",
  "claude-code": "claude-code.png",
  codex: "codex.png",
  cursor: "cursor.png",
  datadog: "datadog.png",
  devin: "devin.png",
  docker: "docker.png",
  factory: "factory.png",
  github: "github.png",
  "github-actions": "github-actions.png",
  "github-copilot": "github-copilot.png",
  gitlab: "gitlab.png",
  jenkins: "jenkins.png",
  "jfrog-artifactory": "jfrog-artifactory.png",
  kubernetes: "kubernetes.png",
  launchdarkly: "launchdarkly.png",
  snyk: "snyk.png",
  sonarqube: "sonarqube.png",
  spinnaker: "spinnaker.png",
  terraform: "terraform.png",
};

/** The path of a tool's bundled logo, or null to show its initials. */
export function logoSrc(toolId: string): string | null {
  const file = Object.hasOwn(BUNDLED_LOGOS, toolId) ? BUNDLED_LOGOS[toolId] : undefined;
  return file ? `/games/guess-who/logos/${file}` : null;
}

/** Up to two initials for a tool's placeholder logo: "Argo CD" → "AC", "Snyk" → "SN". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** A tool id from its name, unique among `taken`. */
export function toolId(name: string, taken: Iterable<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 34) || "tool";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * The tools in the order one round's board shows them: shuffled, so a card's
 * place says nothing about where it sits in the SDLC. The same `seed` always
 * gives the same order, so a reload mid-round leaves every card where it was.
 */
export function boardOrder<T>(tools: readonly T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  // mulberry32
  const next = () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...tools];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// In stage order, which is easy to check in settings; the game shuffles the board (`boardOrder`).
const DEFAULT_NAMES = [
  // Code
  "Cursor",
  "GitHub Copilot",
  "Claude Code",
  "Codex",
  "Devin",
  "Factory",
  // Build
  "Docker",
  // Push
  "GitHub",
  "GitLab",
  "Bitbucket",
  // Integrate
  "Jenkins",
  "GitHub Actions",
  "CircleCI",
  "Azure DevOps",
  "JFrog Artifactory",
  // Test, outer loop
  "Snyk",
  "Checkmarx",
  "SonarQube",
  // Release
  "LaunchDarkly",
  // Deploy
  "Spinnaker",
  "Argo CD",
  "Kubernetes",
  "Terraform",
  // Observe
  "Datadog",
];

/** The 24 tools chosen for the board, from the "Who serves the SDLC" deck (Codex, Checkmarx and Datadog added). */
export const DEFAULT_GUESS_WHO: GuessWhoConfig = {
  questionCap: 12,
  tools: DEFAULT_NAMES.reduce<GuessWhoTool[]>(
    (list, name) => [
      ...list,
      {
        id: toolId(
          name,
          list.map((t) => t.id),
        ),
        name,
      },
    ],
    [],
  ),
  rounds: [
    { red: "snyk", blue: "jenkins" },
    { red: "argo-cd", blue: "launchdarkly" },
    { red: "github-actions", blue: "devin" },
  ],
};
