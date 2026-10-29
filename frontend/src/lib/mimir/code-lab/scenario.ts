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

const ORIGINAL_BUTTON = "#2563eb";

export const START_CODE = `<!DOCTYPE html>
<html>
<head>
<style>
  :root {
    --banner: #14532d;
    --button: ${ORIGINAL_BUTTON};
  }
  body { margin: 0; font-family: system-ui, sans-serif; color: #1c1917; }
  .banner { background: var(--banner); color: white; text-align: center; padding: 40px 24px; }
  .banner h1 { margin: 0 0 8px; font-size: 30px; }
  .banner p { margin: 0 0 20px; opacity: 0.85; }
  .cta { background: var(--button); color: white; border: 0; border-radius: 8px; padding: 12px 22px; font-size: 16px; }
  .products { display: flex; gap: 12px; padding: 20px 24px; }
  .card { flex: 1; border: 1px solid #e7e5e4; border-radius: 12px; padding: 14px; text-align: center; }
  .card p { margin: 4px 0 0; color: #57534e; }
</style>
</head>
<body>
  <section class="banner">
    <h1>Spring Sale: 10% off</h1>
    <p>Everything for your garden, this week only.</p>
    <button class="cta">Shop now</button>
  </section>
  <section class="products">
    <div class="card">🌱<h3>Seed kit</h3><p>$18</p></div>
    <div class="card">🪴<h3>Planter</h3><p>$32</p></div>
    <div class="card">🚿<h3>Watering can</h3><p>$24</p></div>
  </section>
</body>
</html>
`;

export type Task = { id: string; label: string; hint: string; done: (code: string) => boolean };

const headline = (code: string) => /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(code)?.[1] ?? "";
const button = (code: string) => /<button[^>]*>([\s\S]*?)<\/button>/i.exec(code)?.[1] ?? "";
const buttonColour = (code: string) => /--button\s*:\s*([^;}]+)/.exec(code)?.[1]?.trim().toLowerCase() ?? "";

export const TASKS: Task[] = [
  {
    id: "headline",
    label: "Change the headline to 20% off",
    hint: "Find the line that starts with <h1> and change 10% to 20%.",
    done: (code) => /\b20\s*%/.test(headline(code)),
  },
  {
    id: "button-text",
    label: "Make the button say “Shop the sale”",
    hint: "The words between <button …> and </button> are what the button shows.",
    done: (code) => /shop the sale/i.test(button(code)),
  },
  {
    id: "button-colour",
    label: "Give the button a new colour",
    hint: `Near the top, --button sets the button's colour. Try orange, or #ea580c, instead of ${ORIGINAL_BUTTON}.`,
    done: (code) => {
      const colour = buttonColour(code);
      return colour !== "" && colour !== ORIGINAL_BUTTON;
    },
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
