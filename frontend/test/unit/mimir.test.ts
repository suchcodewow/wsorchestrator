/**
 * Mimir's pure parts: what the coach is told in each mode, how a conversation
 * opens, how the mastery signal is read, and the tiers and filters the pages
 * and routes share.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { MIMIR_KINDS } from "@/db/schema";
import { forReplay } from "@/lib/mimir/chat";
import {
  MASTERY_MARKER,
  buildSystemPrompt,
  kickoffFor,
  openerFor,
  readReply,
  type CoachItem,
  type RepContext,
} from "@/lib/mimir/coach";
import {
  COACH_MODES,
  COACH_MODE_FOR,
  ITEM_ID,
  KIND_FIELDS,
  KIND_LABELS,
  LIBRARY_KINDS,
  PROGRESS_KINDS,
  coachModeOf,
  readItemFilter,
  slugFor,
  tierOf,
} from "@/lib/mimir/kinds";

const ITEM: CoachItem = {
  title: "Continuous Delivery & GitOps",
  summary: "Canary, blue/green, rolling.",
  body: "## How it works\nVerification after every deploy.",
  sections: [{ title: "Objections", content: "We already use ArgoCD." }],
  attrs: { buyer: "VP Engineering", scenario: "They use ArgoCD.", salesAngle: "MTTR story." },
};

const NEW_REP: RepContext = { name: null, role: null, coachStyle: "socratic", capabilities: [] };
const SETTINGS = { platformContext: "PLATFORM-FACTS", namingGuard: "NAMING-RULES" };

describe("the coach's prompt", () => {
  test("every mode carries the item, the mastery signal and the naming rules", () => {
    for (const mode of COACH_MODES) {
      const prompt = buildSystemPrompt(mode, ITEM, NEW_REP, SETTINGS);
      assert.ok(prompt.includes(ITEM.title), mode);
      assert.ok(prompt.includes("Verification after every deploy."), `${mode}: the body`);
      assert.ok(prompt.includes("We already use ArgoCD."), `${mode}: the sections`);
      assert.ok(prompt.includes(MASTERY_MARKER), mode);
      assert.ok(prompt.trimEnd().endsWith("NAMING-RULES"), `${mode}: naming rules last`);
    }
  });

  test("the platform context goes to the sales modes and not the teaching ones", () => {
    const has = (mode: (typeof COACH_MODES)[number]) => buildSystemPrompt(mode, ITEM, NEW_REP, SETTINGS).includes("PLATFORM-FACTS");
    assert.deepEqual(
      COACH_MODES.filter(has),
      ["agent", "capability", "competitive", "usecase"],
    );
  });

  test("names the rep and their role, and asks for brevity when they want it direct", () => {
    const prompt = buildSystemPrompt("capability", ITEM, { ...NEW_REP, name: "Sam", role: "AE", coachStyle: "direct" }, SETTINGS);
    assert.match(prompt, /Rep context: Sam \(AE\)/);
    assert.match(prompt, /COACHING STYLE: Be concise and direct/);
    assert.doesNotMatch(buildSystemPrompt("capability", ITEM, NEW_REP, SETTINGS), /Rep context|COACHING STYLE/);
  });

  test("tells the persona coach what the rep has covered, with their takeaways", () => {
    const rep: RepContext = {
      ...NEW_REP,
      capabilities: [
        { title: "CI", tier: "mastered", reflection: "Faster builds, fewer flakes" },
        { title: "IDP", tier: "practiced", reflection: "" },
      ],
    };
    const prompt = buildSystemPrompt("persona", ITEM, rep, SETTINGS);
    assert.match(prompt, /- CI: Mastered — "Faster builds, fewer flakes"/);
    assert.match(prompt, /- IDP: Practiced/);
    assert.match(buildSystemPrompt("persona", ITEM, NEW_REP, SETTINGS), /The rep is new to the product/);
  });

  test("leaves the naming rules out when they are blank", () => {
    const prompt = buildSystemPrompt("concept", ITEM, NEW_REP, { platformContext: "", namingGuard: "  " });
    assert.ok(prompt.trimEnd().endsWith(`${MASTERY_MARKER} on its own line at the very end of your response. If in doubt, don't signal. Use at most once per session, after at least 3 substantive exchanges.`));
  });

  test("is the same every time for the same inputs, so a conversation's prefix never moves", () => {
    for (const mode of COACH_MODES) {
      assert.equal(buildSystemPrompt(mode, ITEM, NEW_REP, SETTINGS), buildSystemPrompt(mode, ITEM, NEW_REP, SETTINGS));
    }
  });
});

describe("agents and capabilities", () => {
  test("a capability is placed in its agent, or among the other products", () => {
    const owned = buildSystemPrompt("capability", { ...ITEM, agent: "Software Delivery Agent" }, NEW_REP, SETTINGS);
    assert.match(owned, /a capability of the Harness Software Delivery Agent/);
    const other = buildSystemPrompt("capability", { ...ITEM, agent: null }, NEW_REP, SETTINGS);
    assert.match(other, /one of Harness's other products/);
  });

  test("an agent's prompt lists its capabilities", () => {
    const prompt = buildSystemPrompt(
      "agent",
      { ...ITEM, title: "Software Delivery Agent", capabilities: ["Deployments", "Builds"] },
      NEW_REP,
      SETTINGS,
    );
    assert.match(prompt, /Its capabilities: Deployments, Builds/);
  });

  test("every sales prompt tells the coach to say capability, never module", () => {
    for (const mode of ["agent", "capability"] as const) {
      assert.match(buildSystemPrompt(mode, ITEM, NEW_REP, SETTINGS), /never "modules"/);
    }
  });
});

describe("opening a conversation", () => {
  test("every mode opens on the item's title", () => {
    for (const mode of COACH_MODES) assert.ok(openerFor(mode, ITEM, NEW_REP).includes(`**${ITEM.title}**`), mode);
  });

  test("a capability with a scenario tests fundamentals before scenarios, and names its agent", () => {
    const owned = { ...ITEM, agent: "Software Delivery Agent" };
    assert.match(openerFor("capability", owned, NEW_REP), /fundamentals solid before we get into scenarios/);
    assert.match(openerFor("capability", owned, NEW_REP), /as part of the Software Delivery Agent/);
    assert.match(openerFor("capability", { ...ITEM, attrs: {} }, NEW_REP), /Ready to deep-dive/);
    assert.doesNotMatch(openerFor("capability", { ...ITEM, attrs: {} }, NEW_REP), /Agent/);
  });

  test("an agent opens on its talk track", () => {
    assert.match(openerFor("agent", { ...ITEM, title: "Cost Management Agent" }, NEW_REP), /agent first, not a list of products/);
  });

  test("the persona opener scales with what the rep has practiced", () => {
    const practiced = (n: number): RepContext => ({
      ...NEW_REP,
      capabilities: Array.from({ length: n }, (_, i) => ({ title: `M${i}`, tier: "practiced" as const, reflection: "" })),
    });
    assert.match(openerFor("persona", ITEM, practiced(0)), /open canvas/);
    assert.match(openerFor("persona", ITEM, practiced(2)), /M0 and M1/);
    assert.match(openerFor("persona", ITEM, practiced(4)), /No scaffolding/);
  });

  test("the kickoff names the item", () => {
    assert.equal(kickoffFor("CI"), "I'd like a coaching session on CI.");
  });
});

describe("reading a reply", () => {
  test("takes the mastery marker out and says it was there", () => {
    assert.deepEqual(readReply(`Great answer.\n\n${MASTERY_MARKER}\n`), { text: "Great answer.", mastery: true });
  });

  test("leaves a reply without it alone", () => {
    assert.deepEqual(readReply("Try again.\n"), { text: "Try again.", mastery: false });
  });
});

describe("kinds", () => {
  test("every kind has labels and an editor field list", () => {
    for (const k of MIMIR_KINDS) {
      assert.ok(KIND_LABELS[k].one && KIND_LABELS[k].many, k);
      assert.ok(Array.isArray(KIND_FIELDS[k]), k);
    }
  });

  test("the coach covers exactly the kinds that have a mode", () => {
    assert.deepEqual(
      MIMIR_KINDS.filter((k) => coachModeOf(k) !== null).sort(),
      Object.keys(COACH_MODE_FOR).sort(),
    );
    for (const mode of Object.values(COACH_MODE_FOR)) assert.ok(COACH_MODES.includes(mode!));
  });

  test("progress is kept on every coached kind, and on discovery groups", () => {
    for (const k of Object.keys(COACH_MODE_FOR)) assert.ok(PROGRESS_KINDS.includes(k as never), k);
    assert.ok(PROGRESS_KINDS.includes("discovery"));
    assert.deepEqual(LIBRARY_KINDS, PROGRESS_KINDS);
  });

  test("an item is mastered only with the coach's signal and a takeaway", () => {
    const at = new Date();
    assert.equal(tierOf(null), "none");
    assert.equal(tierOf({ practicedAt: null, masteryReadyAt: null, reflection: "" }), "viewed");
    assert.equal(tierOf({ practicedAt: at, masteryReadyAt: null, reflection: "" }), "practiced");
    assert.equal(tierOf({ practicedAt: at, masteryReadyAt: at, reflection: " " }), "practiced");
    assert.equal(tierOf({ practicedAt: at, masteryReadyAt: at, reflection: "It's the outer loop." }), "mastered");
  });

  test("reads a list filter, refusing an unknown kind", () => {
    assert.deepEqual(readItemFilter(new URLSearchParams("kind=competitor&cat=cd&featured=1")), {
      filter: { kind: "competitor", cat: "cd", featured: true },
    });
    assert.deepEqual(readItemFilter({ parent: "none" }), { filter: { parentId: null } });
    assert.deepEqual(readItemFilter({ parent: "disc-0" }), { filter: { parentId: "disc-0" } });
    assert.deepEqual(readItemFilter({ kind: "nonsense" }), { error: "invalid_kind" });
  });

  test("makes ids that pass its own rule", () => {
    for (const title of ["Continuous Delivery & GitOps", "vs. GitHub Actions", "🚀", "  "]) {
      assert.match(slugFor(title), ITEM_ID, title);
    }
    assert.equal(slugFor("Continuous Delivery & GitOps"), "continuous-delivery-gitops");
  });
});

describe("replaying a coach turn", () => {
  test("is sent back exactly as it came, when no fallback happened", () => {
    const content = [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "Hi." }];
    assert.equal(forReplay(content), content);
    assert.equal(forReplay("An opener."), "An opener.");
  });

  test("after a mid-reply fallback, leaves out the declined model's thinking but keeps its text", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "a" },
      { type: "text", text: "Part one" },
      { type: "fallback", from: { model: "x" }, to: { model: "y" } },
      { type: "thinking", thinking: "", signature: "b" },
      { type: "text", text: " part two." },
    ];
    assert.deepEqual(
      (forReplay(content) as { type: string }[]).map((b) => b.type),
      ["text", "fallback", "thinking", "text"],
    );
  });
});
