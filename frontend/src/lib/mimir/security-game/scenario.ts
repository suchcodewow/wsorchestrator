/**
 * Day in the Life: Enterprise Security Team. Three "months" of reviewing the
 * builds that pass through a made-up company's pipeline by eye, with rules
 * that pile up each month and the same 20 seconds a page. The builds, rules
 * and totals are those of the in-person slide-deck game this was made from,
 * so the actual counts below (16, 29 and 45) are the deck's. Nothing is real:
 * every app and package name is invented, and nothing is kept.
 */

export type BuildColor = "plain" | "blue" | "red" | "green";

export type Build = {
  /** As the deck wrote it, such as "mox-312-7r". */
  id: string;
  packages: [string, string, string];
  color: BuildColor;
};

export type RoundNumber = 1 | 2 | 3;

export const SECONDS_PER_PAGE = 20;

/** Builds sit two rows of four to a page. */
export const BUILDS_PER_PAGE = 8;

const b = (id: string, packages: string, color: BuildColor = "plain"): Build => ({
  id,
  packages: packages.split(" ") as Build["packages"],
  color,
});

const ROUND_1_PAGES: Build[][] = [
  [
    b("mox-312-7r", "vordant klaxon sprocket"),
    b("zep-094-2f", "luminary creston whelp"),
    b("biv-751-5t", "flanker ossian trevid"),
    b("kal-228-9m", "duskfall pixter grondle"),
    b("wen-463-1b", "solstice vantrum plicker"),
    b("dox-817-4s", "nimbler cradock flesten"),
    b("rup-539-6p", "halvern quiblet stormix"),
    b("fay-182-3w", "crondall whispen oblique"),
  ],
  [
    b("tix-675-8n", "sparrow delvick frostum"),
    b("vel-920-2k", "grundle laxative sworden"),
    b("cob-347-7j", "tantrum whiskey flounder"),
    b("nup-561-4d", "glimber traxion kelpwort"),
    b("yar-213-9v", "sundrop crumble vexling"),
    b("hox-788-1c", "plundle starwick dromble"),
    b("qid-452-6g", "fenwick blaster moriven"),
    b("wuz-139-3a", "clanker dremble postwick"),
  ],
  [
    b("lav-864-5e", "trisket blonken grumple"),
    b("pox-276-8h", "sundial wranker clipsol"),
    b("jib-593-2u", "fendrax grumble skipton"),
    b("nak-417-7y", "wolvren crestix darnble"),
    b("fob-832-4z", "plunket stardom hexwing"),
    b("tud-165-9q", "cremble vortrix glonker"),
    b("wix-748-3l", "brindle sparket duskveil"),
    b("sov-391-6r", "flaxden grumwick starple"),
  ],
];

const ROUND_2_PAGES: Build[][] = [
  [
    b("sov-391-6r", "flaxden grumwick starple"),
    b("keb-524-1m", "drender blixum crondex", "blue"),
    b("zig-879-8t", "whumble postron sklarick"),
    b("pon-236-5f", "trendal glorbin wixster", "blue"),
    b("dav-612-2b", "krumble fenstar plonwick"),
    b("rux-457-7s", "glendar whumper trixcol", "blue"),
    b("yen-983-4p", "dremble blaxon stormlet", "blue"),
    b("gob-341-9w", "vundric crispel flanwick"),
  ],
  [
    b("mip-726-6k", "blunder treskin glorwick", "blue"),
    b("sax-158-3j", "drondal kelpron whistle"),
    b("flu-894-1d", "plaxon crindle starvex", "blue"),
    b("nek-267-8v", "glorket whumble dawnrix"),
    b("bia-531-5c", "crumwick splonker fendrex", "green"),
    b("tov-419-2g", "starlum wrendle blixtar"),
    b("gux-782-7a", "dronkit fenwick crumplor", "blue"),
    b("kip-346-4e", "whovian starblet drenwick"),
  ],
  [
    b("tix-675-8n", "sparrow delvick frostum", "blue"),
    b("vel-920-2k", "grundle laxative sworden"),
    b("cob-347-7j", "tantrum whiskey flounder", "green"),
    b("nup-561-4d", "glimber traxion kelpwort", "green"),
    b("yar-213-9v", "sundrop crumble vexling", "blue"),
    b("hox-788-1c", "plundle starwick dromble", "blue"),
    b("qid-452-6g", "fenwick blaster moriven"),
    b("wuz-139-3a", "clanker dremble postwick", "blue"),
  ],
  [
    b("zav-913-9h", "blonket grumstar plixden", "blue"),
    b("fud-258-6u", "trondle whispen sklarex", "blue"),
    b("rep-674-3y", "blunder crenwick glorstom", "blue"),
    b("wox-821-1z", "drindal plonket starvick", "blue"),
    b("lum-495-8l", "gremble waxford crisping", "red"),
    b("teb-137-5r", "blondar splixum dronwick", "green"),
    b("vox-562-2m", "fendrex glorble whumstar"),
    b("kud-389-7f", "crendle starbrix plonwick", "green"),
  ],
  [
    b("kud-389-7f", "crendle starbrix plonwick", "blue"),
    b("rop-246-9s", "glimwick tronket fendrumble", "green"),
    b("wiv-831-6p", "crisple starvon blunderix", "blue"),
    b("blx-293-4t", "shimber crondex vaultwick", "blue"),
    b("ped-518-7n", "glorstum wrenkit plaxidor", "blue"),
    b("zon-762-1k", "drifwick blonster crumplax", "blue"),
    b("yiv-435-8g", "starndle whumrix glenpost", "green"),
    b("fux-187-3c", "drondix splonket cravwick", "green"),
  ],
];

const ROUND_3_PAGES: Build[][] = [
  [
    b("mip-726-6k", "agitate treskin labrador", "red"),
    b("sax-158-3j", "drondal kelpron whistle", "red"),
    b("flu-894-1d", "plaxon crindle starvex", "red"),
    b("nek-267-8v", "digit labor dawnrix", "red"),
    b("bia-531-5c", "crumwick splonker fendrex", "red"),
    b("tov-419-2g", "agitator wrendle labyrinth", "red"),
    b("gux-782-7a", "dronkit fenwick crumplor", "red"),
    b("kip-346-4e", "whovian starblep drenwick", "red"),
  ],
  [
    b("kud-389-7f", "crendle starbrix plonwick", "blue"),
    b("rop-246-9s", "glimwick tronket fendrumble", "green"),
    b("wiv-831-6p", "crisple starvon blunderix", "blue"),
    b("blx-293-4t", "shimber crondex vaultwick", "blue"),
    b("ped-518-7n", "glorstum wrenkit plaxidor", "blue"),
    b("zon-762-1k", "drifwick blonster crumplax", "blue"),
    b("yiv-435-8g", "starndle whumrix glenpost", "green"),
    b("fux-187-3c", "drondix splonket cravwick", "green"),
  ],
  [
    b("mox-312-7r", "vordant klaxon sprocket", "red"),
    b("zep-094-2f", "luminary creston whelp"),
    b("biv-751-5t", "flanker ossian trevid"),
    b("kal-228-9m", "duskfall pixter grondle", "red"),
    b("wen-463-1b", "solstice vantrum plicker"),
    b("dox-817-4s", "digitize blabber flesten", "red"),
    b("rup-539-6p", "halvern quiblet stormix", "red"),
    b("fay-182-3w", "crondall whispen oblique"),
  ],
  [
    b("tix-675-8n", "sparrow delvick frostum", "blue"),
    b("vel-920-2k", "grundle laxative sworden"),
    b("cob-347-7j", "tantrum whiskey flounder", "green"),
    b("nup-561-4d", "glimber traxion kelpwort", "green"),
    b("yar-213-9v", "sundrop crumble vexling", "blue"),
    b("hox-788-1c", "plundle starwick dromble", "blue"),
    b("qid-452-6g", "fenwick blaster moriven"),
    b("wuz-139-3a", "clanker dremble postwick", "blue"),
  ],
  [
    b("lav-864-5e", "trisket blonken grumple", "green"),
    b("pox-276-8h", "sundial wranker clipsol"),
    b("jib-593-2u", "fendrax grumble skipton", "green"),
    b("nak-417-7y", "wolvren crestix darnble"),
    b("fob-832-4z", "plunket stardom hexwing"),
    b("tud-165-9q", "cremble vortrix glonker", "blue"),
    b("wix-748-3l", "brindle sparket duskveil"),
    b("sov-391-6r", "flaxden grumwick starple", "blue"),
  ],
  [
    b("tix-675-8n", "sparrow delvick frostum", "red"),
    b("vel-920-2k", "grundle laxative sworden", "blue"),
    b("cob-347-7j", "tantrum whiskey flounder", "blue"),
    b("nup-561-4d", "glimber traxion kelpwort"),
    b("yar-213-9v", "sundrop crumble vexling", "red"),
    b("hox-788-1c", "plundle starwick dromble", "red"),
    b("qid-452-6g", "legitimize blaster belabor", "red"),
    b("wuz-139-3a", "clanker dremble postwick"),
  ],
  [
    b("zav-913-9h", "blonket grumstar plixden", "blue"),
    b("fud-258-6u", "trondle whispen sklarex", "blue"),
    b("rep-674-3y", "blunder crenwick glorstom", "blue"),
    b("wox-821-1z", "drindal plonket starvick", "blue"),
    b("lum-495-8l", "gremble waxford crisping", "red"),
    b("teb-137-5r", "blondar splixum dronwick", "green"),
    b("vox-562-2m", "fendrex glorble whumstar"),
    b("kud-389-7f", "crendle starbrix plonwick", "green"),
  ],
];

export type Rule = {
  /** What makes a build vulnerable. */
  text: string;
  /** The fine print that trips people up. */
  tip: string;
};

export type Round = {
  number: RoundNumber;
  rules: Rule[];
  /** True when the rules above the new one are the earlier months' rules. */
  keepsEarlierRules: boolean;
  /** Three sample builds on the rules screen. */
  examples: Build[];
  pages: Build[][];
};

const RULE_P: Rule = {
  text: "Any build with the letter “P” in any package name.",
  tip: "Check the package names only. The word PACKAGES printed on each card doesn’t count.",
};

const RULE_BLUE: Rule = {
  text: "Any blue build where the first digit of the APP ID is even.",
  tip: "The first digit is the first number after the dashes: in CAT-847-3X, it’s the 8.",
};

const RULE_RED: Rule = {
  text: "Any red build where both “git” and “lab” appear in its packages.",
  tip: "They can be in different packages, or buried inside longer words.",
};

export const ROUNDS: Round[] = [
  {
    number: 1,
    rules: [RULE_P],
    keepsEarlierRules: false,
    examples: [
      b("cat-847-3x", "thunder lightning banana"),
      b("run-293-7m", "power fortress penguin"),
      b("fog-561-2k", "marble cabinet porch"),
    ],
    pages: ROUND_1_PAGES,
  },
  {
    number: 2,
    rules: [RULE_BLUE],
    keepsEarlierRules: true,
    examples: [
      b("cat-847-3x", "thunder lightning apple", "blue"),
      b("run-393-7m", "lower fortress crow", "blue"),
      b("fog-561-2k", "marble cabinet porch"),
    ],
    pages: ROUND_2_PAGES,
  },
  {
    number: 3,
    rules: [RULE_RED],
    keepsEarlierRules: true,
    examples: [
      b("cat-847-3x", "gitirdone lightning labrador", "red"),
      b("run-393-7m", "labrador fortress crow", "red"),
      b("fog-561-2k", "marble cabinet slug"),
    ],
    pages: ROUND_3_PAGES,
  },
];

/** Every rule in force in a month: its own and all those before it. */
export function rulesInForce(round: RoundNumber): Rule[] {
  return ROUNDS.filter((r) => r.number <= round).flatMap((r) => r.rules);
}

/** The first digit of a build's APP ID: the 8 in "cat-847-3x". */
function firstDigit(build: Build): number {
  return Number(build.id.split("-")[1][0]);
}

/** Why a build is vulnerable in a month, one line per rule it breaks. Empty when it is fine. */
export function whyVulnerable(build: Build, round: RoundNumber): string[] {
  const why: string[] = [];
  const withP = build.packages.filter((p) => p.includes("p")).map((p) => `“${p}”`);
  if (withP.length) why.push(`${withP.join(" and ")} ${withP.length === 1 ? "has" : "have"} a P`);
  if (round >= 2 && build.color === "blue" && firstDigit(build) % 2 === 0) {
    why.push(`blue build, and ${firstDigit(build)} is even`);
  }
  if (round >= 3 && build.color === "red") {
    const git = build.packages.find((p) => p.includes("git"));
    const lab = build.packages.find((p) => p.includes("lab"));
    if (git && lab) why.push(git === lab ? `red build, and “${git}” has both git and lab` : `red build with “${git}” and “${lab}”`);
  }
  return why;
}

export const isVulnerable = (build: Build, round: RoundNumber) => whyVulnerable(build, round).length > 0;

/** Where a match sits in a string: from `start`, up to but not including `end`. */
export type Span = { start: number; end: number };

/** Exactly what makes a build vulnerable, so it can be circled. Empty everywhere when the build is fine. */
export type Marks = {
  /** For each package, the letters that break a rule. */
  packages: [Span[], Span[], Span[]];
  /** Where the APP ID's first digit sits in `build.id`, when the blue rule catches it. */
  digit?: Span;
  /** True when the build's color is part of why it is caught. */
  color: boolean;
};

/** Every place `needle` appears in `word`. */
function spansOf(word: string, needle: string): Span[] {
  const spans: Span[] = [];
  for (let i = word.indexOf(needle); i !== -1; i = word.indexOf(needle, i + needle.length)) {
    spans.push({ start: i, end: i + needle.length });
  }
  return spans;
}

/** The rules of `whyVulnerable`, pointing at what they matched: every P, the even first digit, every git and lab. */
export function marksFor(build: Build, round: RoundNumber): Marks {
  const packages: Marks["packages"] = [[], [], []];
  let digit: Span | undefined;
  let color = false;
  if (build.packages.some((p) => p.includes("p"))) {
    build.packages.forEach((p, i) => packages[i].push(...spansOf(p, "p")));
  }
  if (round >= 2 && build.color === "blue" && firstDigit(build) % 2 === 0) {
    const at = build.id.indexOf("-") + 1;
    digit = { start: at, end: at + 1 };
    color = true;
  }
  if (
    round >= 3 &&
    build.color === "red" &&
    build.packages.some((p) => p.includes("git")) &&
    build.packages.some((p) => p.includes("lab"))
  ) {
    build.packages.forEach((p, i) => packages[i].push(...spansOf(p, "git"), ...spansOf(p, "lab")));
    color = true;
  }
  // Matches that touch, like the two P's in "apple", are circled as one.
  const merged = packages.map((spans) =>
    spans
      .sort((a, b) => a.start - b.start)
      .reduce<Span[]>((out, span) => {
        const last = out.at(-1);
        if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
        else out.push({ ...span });
        return out;
      }, []),
  ) as Marks["packages"];
  return { packages: merged, ...(digit && { digit }), color };
}

/** How many vulnerable builds a month really holds. */
export function actualCount(round: Round): number {
  return round.pages.flat().filter((x) => isVulnerable(x, round.number)).length;
}

/** The deck's scoring: 10 for the exact count, 5 for one off, 2 for two off, nothing beyond. */
export function pointsFor(counted: number, actual: number): number {
  const off = Math.abs(counted - actual);
  return off === 0 ? 10 : off === 1 ? 5 : off === 2 ? 2 : 0;
}

export const MAX_SCORE = ROUNDS.length * 10;

export type Review = { from: number; to: number; title: string; verdict: string; pizza?: boolean };

/** The performance review at the end of the third month. */
export const REVIEWS: Review[] = [
  {
    from: 0,
    to: 10,
    title: "Surprise meeting with HR",
    verdict: "A calendar invite appears: “Quick sync (confidential).” Please bring your badge and your laptop.",
  },
  {
    from: 11,
    to: 20,
    title: "Performance Improvement Plan",
    verdict:
      "You’ve been placed on a PIP. Next steps are outlined in the attached document. Go ahead and Google “Performance Improvement Plan” if you’re curious.",
  },
  {
    from: 21,
    to: 27,
    title: "Meets Expectations",
    verdict: "“Solid work. Keep it up.” You made the cut, and nobody mentions it again until next quarter.",
  },
  {
    from: 28,
    to: 30,
    title: "Meets Expectations… but also pizza party",
    verdict: "Officially it’s a “Meets Expectations”, but someone ordered pizza and your name is on the card.",
    pizza: true,
  },
];

export function reviewFor(total: number): Review {
  return REVIEWS.find((r) => total >= r.from && total <= r.to) ?? REVIEWS[0];
}
