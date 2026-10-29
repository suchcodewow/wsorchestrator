/**
 * The Code Lab's practice task: a made-up garden shop's home page, the ticket
 * asking for a change to it, and how to tell each part of the ticket is done.
 * Nothing here is real: there is no repository, and every hash, check and
 * reviewer is invented for the exercise.
 */

export const REPO = "greenleaf/storefront";
export const FILE = "index.html";

export const TICKET = {
  id: "GRN-142",
  title: "Spring sale goes to 20% off",
  from: "Jordan, Product",
  body: "Marketing approved a bigger discount for the spring sale. Can we update the home page banner before the email goes out?",
};

export const SUGGESTED_BRANCH = "feature/GRN-142-spring-sale";

const ORIGINAL_BUTTON = "royalblue";

/**
 * The shop's stylesheet: everything about the page's look that the exercise
 * doesn't ask anyone to touch. The page links it, so the code a beginner sees
 * holds only the two rules the ticket is about; the preview puts it back.
 */
const SHOP_CSS = `
  body { margin: 0; font-family: system-ui, sans-serif; color: #1c1917; }
  .banner { text-align: center; padding: 40px 24px; }
  .banner h1 { margin: 0 0 8px; font-size: 30px; }
  .banner p { margin: 0 0 20px; opacity: 0.85; }
  .button { border: 0; border-radius: 8px; padding: 12px 22px; font-size: 16px; }
  .products { display: flex; gap: 12px; padding: 20px 24px; }
  .card { flex: 1; border: 1px solid #e7e5e4; border-radius: 12px; padding: 14px; text-align: center; }
  .card p { margin: 4px 0 0; color: #57534e; }
`;

const SHOP_CSS_LINK = /<link[^>]*href=["']shop\.css["'][^>]*>/i;

/** The page as a browser would show it, with the stylesheet it links filled in. */
export function pageHtml(code: string): string {
  return code.replace(SHOP_CSS_LINK, () => `<style>${SHOP_CSS}</style>`);
}

export const START_CODE = `<!DOCTYPE html>
<html>
<head>
<link rel="stylesheet" href="shop.css">
<style>
  .banner {
    background: darkgreen;
    color: white;
  }
  .button {
    background: ${ORIGINAL_BUTTON};
    color: white;
  }
</style>
</head>
<body>
  <section class="banner">
    <h1>Spring Sale: 10% off</h1>
    <p>Everything for your garden, this week only.</p>
    <button class="button">Shop now</button>
  </section>
  <section class="products">
    <div class="card">🌱<h3>Seed kit</h3><p>$18</p></div>
    <div class="card">🪴<h3>Planter</h3><p>$32</p></div>
    <div class="card">🚿<h3>Watering can</h3><p>$24</p></div>
  </section>
</body>
</html>
`;

type Range = [number, number];

export type Task = {
  id: string;
  label: string;
  hint: string;
  /** The code the change could end up as, for the hint to show. */
  suggestion: string;
  done: (code: string) => boolean;
  /** Where in the page the change goes, as a [start, end) range, or null if it can't be found any more. */
  locate: (code: string) => Range | null;
};

/** The range of a regular expression's first group in the code. The expression needs the d flag. */
const group = (re: RegExp) => (code: string) => re.exec(code)?.indices?.[1] ?? null;

const headlineAt = group(/<h1[^>]*>([\s\S]*?)<\/h1>/di);
const buttonAt = group(/<button[^>]*>([\s\S]*?)<\/button>/di);
const buttonColourAt = group(/\.button\s*\{[^}]*?background\s*:\s*([^;}]*[^;}\s])/d);
/** The headline's percentage, which is all that needs to change, or the whole headline once it has none. */
const headlinePercentAt = (code: string): Range | null => {
  const h1 = headlineAt(code);
  if (!h1) return null;
  const pc = /\d+\s*%/.exec(code.slice(...h1));
  return pc ? [h1[0] + pc.index, h1[0] + pc.index + pc[0].length] : h1;
};
const text = (at: (code: string) => Range | null) => (code: string) => {
  const range = at(code);
  return range ? code.slice(...range) : "";
};
const headline = text(headlineAt);
const button = text(buttonAt);
const buttonColour = (code: string) => text(buttonColourAt)(code).trim().toLowerCase();

export const TASKS: Task[] = [
  {
    id: "headline",
    label: "Change the headline to 20% off",
    hint: "Between <h1> and </h1> is the big headline. Change 10% to 20%.",
    suggestion: "<h1>Spring Sale: 20% off</h1>",
    done: (code) => /\b20\s*%/.test(headline(code)),
    locate: headlinePercentAt,
  },
  {
    id: "button-text",
    label: "Make the button say “Shop the sale”",
    hint: "The words between <button …> and </button> are what the button shows.",
    suggestion: '<button class="button">Shop the sale</button>',
    done: (code) => /shop the sale/i.test(button(code)),
    locate: buttonAt,
  },
  {
    id: "button-colour",
    label: "Give the button a new colour",
    hint: `In the style section, .button says how the button looks. Change ${ORIGINAL_BUTTON} to another colour, like orange.`,
    suggestion: "background: orange;",
    done: (code) => {
      const colour = buttonColour(code);
      return colour !== "" && colour !== ORIGINAL_BUTTON;
    },
    locate: buttonColourAt,
  },
];

/** A commit hash that looks the part: seven hex digits, the same for the same content. */
export function fakeHash(seed: string): string {
  let h = 0x811c9dc5;
  for (let k = 0; k < seed.length; k++) {
    h ^= seed.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 7);
}

/** A branch name git would take: no spaces, nothing it treats as special. */
export function cleanBranchName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[~^:?*[\]\\]+/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-/.]+|[/.]+$/g, "");
}
