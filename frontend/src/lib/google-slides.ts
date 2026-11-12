/**
 * The one-slide "Thank You!" deck the Guest judges tab makes: a title and a
 * grid of the judges' round photos, each with a name, sized so all of them fit.
 * `thankYouRequests` is the slide as Slides API `batchUpdate` requests, kept
 * apart from the calls so the layout can be tested without Google.
 */

import "server-only";
import type { CalendarClient } from "@/lib/google-calendar";

export const SLIDES_API = "https://slides.googleapis.com/v1";
export const DRIVE_API = "https://www.googleapis.com/drive/v3";

/** `photoUrl` is the already-round picture; someone who helped more than once (`times`) gets the 2X flame. */
export type SlideJudge = { name: string; photoUrl: string; times: number };

const EMU_PER_INCH = 914_400;
const inch = (n: number) => Math.round(n * EMU_PER_INCH);
// Slides' default 16:9 page, 10 x 5.625 inches.
const PAGE = { w: 10, h: 5.625 };
const MARGIN = 0.3;
const TITLE_H = 0.8;
const MIN_FONT = 6;
const MAX_FONT = 11;
const WHITE = { red: 1, green: 1, blue: 1 };

/** The columns and rows that give the largest photo, a name of up to two lines under it included, to `count` judges. */
export function gridFor(count: number): { cols: number; rows: number; cellW: number; cellH: number; photo: number; fontPt: number } {
  const areaW = PAGE.w - 2 * MARGIN;
  const areaH = PAGE.h - TITLE_H - MARGIN;
  let best = { cols: 1, rows: 1, cellW: areaW, cellH: areaH, photo: 0, fontPt: MIN_FONT };
  for (let cols = 1; cols <= Math.max(1, count); cols++) {
    const rows = Math.ceil(Math.max(1, count) / cols);
    const cellW = areaW / cols;
    const cellH = areaH / rows;
    const fontPt = Math.max(MIN_FONT, Math.min(MAX_FONT, Math.floor(cellW * 8)));
    const nameH = (2 * fontPt * 1.2) / 72 + 0.03;
    const photo = Math.min(cellW * 0.92, cellH - nameH);
    if (photo > best.photo) best = { cols, rows, cellW, cellH, photo, fontPt };
  }
  return best;
}

/** Requests that replace the new deck's starter slide with the thank-you slide, `judges` in the order given. */
export function thankYouRequests(starterSlideId: string, judges: SlideJudge[], backgroundUrl?: string): unknown[] {
  const slideId = "thank_you";
  const requests: unknown[] = [
    { createSlide: { objectId: slideId, slideLayoutReference: { predefinedLayout: "BLANK" } } },
    { deleteObject: { objectId: starterSlideId } },
  ];
  if (backgroundUrl) {
    requests.push({
      updatePageProperties: {
        objectId: slideId,
        pageProperties: { pageBackgroundFill: { stretchedPictureFill: { contentUrl: backgroundUrl } } },
        fields: "pageBackgroundFill",
      },
    });
  }
  requests.push(textBox("title", slideId, MARGIN, 0.1, PAGE.w - 2 * MARGIN, TITLE_H - 0.1, "Thank You!", 36, true, WHITE));
  const { cols, cellW, cellH, photo, fontPt } = gridFor(judges.length);
  judges.forEach((j, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * cellW;
    const y = TITLE_H + row * cellH;
    const px = x + (cellW - photo) / 2;
    requests.push({
      createImage: {
        objectId: `photo_${i}`,
        url: j.photoUrl,
        elementProperties: {
          pageObjectId: slideId,
          size: { width: { magnitude: inch(photo), unit: "EMU" }, height: { magnitude: inch(photo), unit: "EMU" } },
          transform: { scaleX: 1, scaleY: 1, translateX: inch(px), translateY: inch(y), unit: "EMU" },
        },
      },
    });
    requests.push(textBox(`name_${i}`, slideId, x, y + photo + 0.02, cellW, cellH - photo - 0.02, j.name, fontPt, false, WHITE));
    if (j.times >= 2) requests.push(...flame(`flame_${i}`, slideId, px + photo, y + photo * 0.95, photo));
  });
  return requests;
}

/** One breakout instructor's column: who leads it, where, and who goes with them. */
export type BreakoutColumn = { leader: string; room: string | null; people: string[] };

/** At most this many instructors share a row of the breakout slide; more wrap onto a second. */
const BREAKOUT_PER_ROW = 5;
const BREAKOUT_MAX_FONT = 24;

/** The grid and font that fit `columns` on the breakout slide: every name on one line, every column the same height. */
export function breakoutGrid(columns: BreakoutColumn[]): { cols: number; rows: number; cellW: number; cellH: number; fontPt: number } {
  const count = Math.max(1, columns.length);
  const cols = count <= BREAKOUT_PER_ROW ? count : Math.ceil(count / 2);
  const rows = Math.ceil(count / cols);
  const cellW = (PAGE.w - 2 * MARGIN) / cols;
  const cellH = (PAGE.h - TITLE_H - MARGIN) / rows;
  const lines = 2 + Math.max(0, ...columns.map((c) => c.people.length));
  const wide = (texts: string[]) => Math.max(8, ...texts.map((t) => t.length));
  const room = (cellW - 0.2) * 72;
  // The leader's name is set two points larger and bold, so it needs the more generous width per character.
  const byHeight = Math.floor(((cellH - 0.15) * 72) / (lines * 1.25));
  const byWidth = Math.min(
    Math.floor(room / (wide(columns.flatMap((c) => [c.room ?? "", ...c.people])) * 0.55)),
    Math.floor(room / (wide(columns.map((c) => c.leader)) * 0.64)) - 2,
  );
  return { cols, rows, cellW, cellH, fontPt: Math.max(MIN_FONT, Math.min(BREAKOUT_MAX_FONT, byHeight, byWidth)) };
}

/** Requests that replace the new deck's starter slide with a breakout's slide: its name over a card for each instructor. */
export function breakoutRequests(starterSlideId: string, title: string, columns: BreakoutColumn[]): unknown[] {
  const slideId = "breakout";
  const requests: unknown[] = [
    { createSlide: { objectId: slideId, slideLayoutReference: { predefinedLayout: "BLANK" } } },
    { deleteObject: { objectId: starterSlideId } },
    textBox("title", slideId, MARGIN, 0.1, PAGE.w - 2 * MARGIN, TITLE_H - 0.1, title, title.length > 40 ? 24 : 32, true),
  ];
  const { cols, cellW, cellH, fontPt } = breakoutGrid(columns);
  const pad = 0.06;
  columns.forEach((c, i) => {
    const id = `card_${i}`;
    const head = c.leader;
    const sub = c.room ?? "No room";
    const text = [head, sub, ...c.people].join("\n");
    requests.push(
      {
        createShape: {
          objectId: id,
          shapeType: "TEXT_BOX",
          elementProperties: {
            pageObjectId: slideId,
            size: { width: { magnitude: inch(cellW - 2 * pad), unit: "EMU" }, height: { magnitude: inch(cellH - 2 * pad), unit: "EMU" } },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: inch(MARGIN + (i % cols) * cellW + pad),
              translateY: inch(TITLE_H + Math.floor(i / cols) * cellH + pad),
              unit: "EMU",
            },
          },
        },
      },
      {
        updateShapeProperties: {
          objectId: id,
          shapeProperties: {
            outline: {
              outlineFill: { solidFill: { color: { rgbColor: { red: 0.8, green: 0.8, blue: 0.8 } } } },
              weight: { magnitude: 0.75, unit: "PT" },
            },
          },
          fields: "outline",
        },
      },
      { insertText: { objectId: id, text } },
      { updateTextStyle: { objectId: id, style: { fontSize: { magnitude: fontPt, unit: "PT" } }, fields: "fontSize" } },
      {
        updateTextStyle: {
          objectId: id,
          textRange: { type: "FIXED_RANGE", startIndex: 0, endIndex: head.length },
          style: { bold: true, fontSize: { magnitude: fontPt + 2, unit: "PT" } },
          fields: "bold,fontSize",
        },
      },
      {
        updateTextStyle: {
          objectId: id,
          textRange: { type: "FIXED_RANGE", startIndex: head.length + 1, endIndex: head.length + 1 + sub.length },
          style: { italic: true, foregroundColor: { opaqueColor: { rgbColor: { red: 0.35, green: 0.35, blue: 0.35 } } } },
          fields: "italic,foregroundColor",
        },
      },
      { updateParagraphStyle: { objectId: id, style: { alignment: "START" }, fields: "alignment" } },
    );
  });
  return requests;
}

/**
 * A small flame-orange pill reading "🔥2X", its lower right corner at (`right`, `bottom`). Slides gives a shape's own text
 * a fixed inset the API cannot change, so the pill is sized to the text alone and the text sits in a wider box over it.
 */
function flame(id: string, pageId: string, right: number, bottom: number, photo: number) {
  const pt = Math.max(5, Math.min(8, Math.floor(photo * 0.34 * 40)));
  const w = (pt * 2.8) / 72 + 0.08;
  const h = (pt * 1.25) / 72 + 0.05;
  const x = right - w;
  const y = bottom - h;
  return [
    {
      createShape: {
        objectId: id,
        shapeType: "ROUND_RECTANGLE",
        elementProperties: {
          pageObjectId: pageId,
          size: { width: { magnitude: inch(w), unit: "EMU" }, height: { magnitude: inch(h), unit: "EMU" } },
          transform: { scaleX: 1, scaleY: 1, translateX: inch(x), translateY: inch(y), unit: "EMU" },
        },
      },
    },
    {
      updateShapeProperties: {
        objectId: id,
        shapeProperties: {
          shapeBackgroundFill: { solidFill: { color: { rgbColor: { red: 0.85, green: 0.2, blue: 0.05 } } } },
          outline: { outlineFill: { solidFill: { color: { rgbColor: WHITE } } }, weight: { magnitude: 0.75, unit: "PT" } },
        },
        fields: "shapeBackgroundFill,outline",
      },
    },
    ...textBox(`flametext_${id.slice("flame_".length)}`, pageId, x - 0.3, y, w + 0.6, h, "🔥 2X", pt, true, WHITE, "MIDDLE"),
  ];
}

function textBox(
  id: string,
  pageId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  pt: number,
  bold: boolean,
  color?: { red: number; green: number; blue: number },
  verticalAlign?: "MIDDLE",
) {
  return [
    {
      createShape: {
        objectId: id,
        shapeType: "TEXT_BOX",
        elementProperties: {
          pageObjectId: pageId,
          size: { width: { magnitude: inch(w), unit: "EMU" }, height: { magnitude: inch(h), unit: "EMU" } },
          transform: { scaleX: 1, scaleY: 1, translateX: inch(x), translateY: inch(y), unit: "EMU" },
        },
      },
    },
    { insertText: { objectId: id, text } },
    {
      updateTextStyle: {
        objectId: id,
        style: {
          fontSize: { magnitude: pt, unit: "PT" },
          bold,
          ...(color ? { foregroundColor: { opaqueColor: { rgbColor: color } } } : {}),
        },
        fields: color ? "fontSize,bold,foregroundColor" : "fontSize,bold",
      },
    },
    { updateParagraphStyle: { objectId: id, style: { alignment: "CENTER" }, fields: "alignment" } },
    ...(verticalAlign
      ? [{ updateShapeProperties: { objectId: id, shapeProperties: { contentAlignment: verticalAlign }, fields: "contentAlignment" } }]
      : []),
  ];
}

/**
 * Makes a one-slide deck in `folderId`, shares it with `shareWith`, and gives its link. `requests` turns the new deck's
 * starter slide id into the Slides requests that make the slide. A deck already there with the same title is trashed first.
 */
export async function createSlideDeck(
  slides: CalendarClient,
  drive: CalendarClient,
  input: { title: string; shareWith: string; folderId: string; requests: (starterSlideId: string) => unknown[] },
): Promise<{ id: string; url: string }> {
  const old = await drive.call<{ files?: { id: string }[] }>("GET", "/files", {
    query: {
      q: `name = '${input.title.replace(/['\\]/g, "\\$&")}' and '${input.folderId}' in parents and mimeType = 'application/vnd.google-apps.presentation' and trashed = false`,
      fields: "files(id)",
      pageSize: "100",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    },
  });
  for (const file of old?.files ?? [])
    await drive.call("PATCH", `/files/${file.id}`, { query: { supportsAllDrives: "true" }, body: { trashed: true } });
  const deck = await slides.call<{ presentationId: string; slides: { objectId: string }[] }>("POST", "/presentations", {
    body: { title: input.title },
  });
  await slides.call("POST", `/presentations/${deck.presentationId}:batchUpdate`, {
    body: { requests: input.requests(deck.slides[0].objectId).flat() },
  });
  await drive.call("PATCH", `/files/${deck.presentationId}`, {
    query: { addParents: input.folderId, removeParents: "root", supportsAllDrives: "true" },
  });
  await drive.call("POST", `/files/${deck.presentationId}/permissions`, {
    query: { sendNotificationEmail: "false", supportsAllDrives: "true" },
    body: { type: "user", role: "writer", emailAddress: input.shareWith },
  });
  return { id: deck.presentationId, url: `https://docs.google.com/presentation/d/${deck.presentationId}/edit` };
}

/** The thank-you deck: `createSlideDeck` with the judges' slide. */
export async function createThankYouDeck(
  slides: CalendarClient,
  drive: CalendarClient,
  input: { title: string; judges: SlideJudge[]; shareWith: string; folderId: string; backgroundUrl?: string },
): Promise<{ id: string; url: string }> {
  return createSlideDeck(slides, drive, {
    title: input.title,
    shareWith: input.shareWith,
    folderId: input.folderId,
    requests: (starter) => thankYouRequests(starter, input.judges, input.backgroundUrl),
  });
}
