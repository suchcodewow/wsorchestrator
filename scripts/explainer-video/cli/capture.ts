// Performs a training video's steps in Chrome against a running demo of the app and saves what each one looked
// like, for src/Screen.tsx to play back. Sign-in is a session row's token (TESTING.md, "A screenshot of a
// signed-in page"); point it only at a demo deployment whose people are made up.
// Usage: npx tsx cli/capture.ts guest-judge-schedule --session <token> [--base http://localhost:3100]
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { ROOT } from "../lib/config.js";
import { captureFile, VIEWPORT, type Box, type Capture, type CapturedStep, type ShotList, type Step } from "../lib/training.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const id = process.argv[2];
const session = arg("--session") ?? process.env.TRAINING_SESSION;
const base = arg("--base") ?? "http://localhost:3100";
if (!id || id.startsWith("--") || !session) throw new Error("Usage: tsx cli/capture.ts <video-id> --session <token> [--base <url>]");

const { shots } = (await import(path.join(ROOT, "src/videos", `${id}.tsx`))) as { shots?: ShotList };
if (!shots) throw new Error(`src/videos/${id}.tsx exports no \`shots\`; it is not a training video.`);

// What only a dev server shows: its environment badge and Next's build indicator.
const HIDE = `span[title$="not production"], nextjs-portal { display: none !important; }`;
// Long enough for a page's entrance animations to finish.
const SETTLE_MS = 900;
const scale = VIEWPORT.scale;

const dir = path.join(ROOT, "public/training", id);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
  deviceScaleFactor: scale,
  colorScheme: "light",
  reducedMotion: "no-preference",
});
await context.addCookies([{ name: "authjs.session-token", value: session, url: base }]);
await context.addInitScript((css) => {
  document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
  });
}, HIDE);
const page = await context.newPage();

async function settle(p: Page) {
  await p.waitForLoadState("networkidle").catch(() => {});
  await p.waitForTimeout(SETTLE_MS);
}

let shotCount = 0;
async function shoot(): Promise<string> {
  const rel = `training/${id}/shot-${String(shotCount++).padStart(3, "0")}.png`;
  await page.screenshot({ path: path.join(ROOT, "public", rel) });
  return rel;
}

async function boxOf(target: string): Promise<Box> {
  const el = page.locator(target).first();
  await el.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {
    throw new Error(`Nothing visible matches ${target} on ${page.url()}`);
  });
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  if (!b) throw new Error(`${target} has no box on ${page.url()}`);
  return { x: b.x * scale, y: b.y * scale, w: b.width * scale, h: b.height * scale };
}

const centre = (b: Box) => ({ x: (b.x + b.w / 2) / scale, y: (b.y + b.h / 2) / scale });

async function perform(step: Exclude<Step, { do: "goto" }>): Promise<CapturedStep> {
  switch (step.do) {
    case "click":
    case "hover":
    case "point": {
      const box = await boxOf(step.target);
      const c = centre(box);
      await page.mouse.move(c.x, c.y, { steps: 8 });
      if (step.do === "click") await page.mouse.click(c.x, c.y);
      await settle(page);
      return { box, after: await shoot() };
    }
    case "type": {
      const box = await boxOf(step.target);
      const c = centre(box);
      await page.mouse.click(c.x, c.y);
      const frames: string[] = [];
      for (const ch of step.text) {
        await page.keyboard.type(ch);
        await page.waitForTimeout(40);
        frames.push(await shoot());
      }
      await settle(page);
      return { box, frames, after: await shoot() };
    }
    case "scroll": {
      const box = step.target ? await boxOf(step.target) : null;
      if (box) await page.mouse.move(centre(box).x, centre(box).y);
      await page.mouse.wheel(0, step.by);
      await settle(page);
      return { box, after: await shoot() };
    }
    case "press":
      await page.keyboard.press(step.key);
      await settle(page);
      return { box: null, after: await shoot() };
  }
}

const capture: Capture = { id, width: Math.round(VIEWPORT.width * scale), height: Math.round(VIEWPORT.height * scale), scenes: [] };
await page.goto(base + shots.start);
await settle(page);
if (new URL(page.url()).pathname.startsWith("/sign-in") || page.url().includes("/api/auth/signin")) {
  throw new Error("The session token did not sign in; check its sessions row.");
}

for (const [i, steps] of shots.scenes.entries()) {
  for (const step of steps.filter((s) => s.do === "goto")) {
    await page.goto(base + step.path);
    await settle(page);
  }
  const scene: Capture["scenes"][number] = { start: await shoot(), steps: [] };
  for (const step of steps) {
    if (step.do === "goto") continue;
    scene.steps.push(await perform(step));
  }
  capture.scenes.push(scene);
  console.log(`scene ${i + 1}: ${scene.steps.length} steps`);
}

writeFileSync(path.join(ROOT, "public", captureFile(id)), JSON.stringify(capture, null, 1));
await browser.close();
console.log(`${shotCount} pictures -> public/training/${id}/`);
