/**
 * Turns the course deck's exported slide images into what the map's hover
 * preview shows: one `<n>.jpg` per slide, 960 pixels wide.
 *
 *   cd frontend
 *   npx tsx scripts/mimir-slides-prepare.ts ~/path/to/exported-pngs ~/path/to/slides-out
 *
 * Export the deck from PowerPoint with File → Export → PNG (all slides). Each
 * file's slide number is the number in its name (`Slide7.PNG`, `slide-07.png`,
 * `7.png`). Then upload the result with `scripts/mimir-upload-slides.sh`.
 *
 * The slides are not public and this repository is, so both folders live
 * outside it.
 */

import { mkdirSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import sharp from "sharp";
import { MAP_SLIDE_LIMIT } from "../src/lib/mimir/map/schema";

const WIDTH = 960;

const [from, to] = process.argv.slice(2).map((p) => (p ? resolve(p.replace(/^~(?=\/)/, process.env.HOME ?? "~")) : ""));
if (!from || !to) {
  console.error("Usage: npx tsx scripts/mimir-slides-prepare.ts <folder of exported images> <folder to write the JPEGs to>");
  process.exit(1);
}
mkdirSync(to, { recursive: true });

const seen = new Map<number, string>();
for (const file of readdirSync(from)) {
  if (![".png", ".jpg", ".jpeg"].includes(extname(file).toLowerCase())) continue;
  const m = /(\d+)\.[a-z]+$/i.exec(file);
  const n = m ? Number(m[1]) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAP_SLIDE_LIMIT) {
    console.error(`Skipping ${file}: no slide number from 1 to ${MAP_SLIDE_LIMIT} in its name`);
    continue;
  }
  if (seen.has(n)) {
    console.error(`${file} and ${seen.get(n)} are both slide ${n}`);
    process.exit(1);
  }
  seen.set(n, file);
}
if (seen.size === 0) {
  console.error(`No slide images in ${from}`);
  process.exit(1);
}

for (const [n, file] of [...seen].sort((a, b) => a[0] - b[0])) {
  await sharp(join(from, file)).resize({ width: WIDTH, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toFile(join(to, `${n}.jpg`));
}
const numbers = [...seen.keys()].sort((a, b) => a - b);
const missing = Array.from({ length: numbers[numbers.length - 1]! }, (_, i) => i + 1).filter((n) => !seen.has(n));
console.log(`Wrote ${seen.size} slides to ${to}${missing.length ? `; no image for slide ${missing.join(", ")}` : ""}`);
