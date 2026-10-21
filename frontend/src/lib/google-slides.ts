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
export function thankYouRequests(starterSlideId: string, judges: SlideJudge[]): unknown[] {
  const slideId = "thank_you";
  const requests: unknown[] = [
    { createSlide: { objectId: slideId, slideLayoutReference: { predefinedLayout: "BLANK" } } },
    { deleteObject: { objectId: starterSlideId } },
    textBox("title", slideId, MARGIN, 0.1, PAGE.w - 2 * MARGIN, TITLE_H - 0.1, "Thank You!", 36, true),
  ];
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
    requests.push(textBox(`name_${i}`, slideId, x, y + photo + 0.02, cellW, cellH - photo - 0.02, j.name, fontPt, false));
    if (j.times >= 2) requests.push(...flame(`flame_${i}`, slideId, px + photo * 0.52, y + photo * 0.58, photo * 0.5, photo * 0.34));
  });
  return requests;
}

/** A small flame-orange badge reading "🔥2X", its corner at the photo's lower right. */
function flame(id: string, pageId: string, x: number, y: number, w: number, h: number) {
  const pt = Math.max(5, Math.min(10, Math.floor(h * 50)));
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
          outline: { outlineFill: { solidFill: { color: { rgbColor: { red: 1, green: 1, blue: 1 } } } }, weight: { magnitude: 0.75, unit: "PT" } },
        },
        fields: "shapeBackgroundFill,outline",
      },
    },
    { insertText: { objectId: id, text: "🔥2X" } },
    {
      updateTextStyle: {
        objectId: id,
        style: {
          fontSize: { magnitude: pt, unit: "PT" },
          bold: true,
          foregroundColor: { opaqueColor: { rgbColor: { red: 1, green: 1, blue: 1 } } },
        },
        fields: "fontSize,bold,foregroundColor",
      },
    },
    { updateParagraphStyle: { objectId: id, style: { alignment: "CENTER" }, fields: "alignment" } },
    { updateShapeProperties: { objectId: id, shapeProperties: { contentAlignment: "MIDDLE" }, fields: "contentAlignment" } },
  ];
}

function textBox(id: string, pageId: string, x: number, y: number, w: number, h: number, text: string, pt: number, bold: boolean) {
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
        style: { fontSize: { magnitude: pt, unit: "PT" }, bold },
        fields: "fontSize,bold",
      },
    },
    { updateParagraphStyle: { objectId: id, style: { alignment: "CENTER" }, fields: "alignment" } },
  ];
}

/** Makes the deck in `folderId`, shares it with `shareWith`, and gives its link. A deck already there with the same title is trashed first. */
export async function createThankYouDeck(
  slides: CalendarClient,
  drive: CalendarClient,
  input: { title: string; judges: SlideJudge[]; shareWith: string; folderId: string },
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
  for (const file of old?.files ?? []) await drive.call("PATCH", `/files/${file.id}`, { query: { supportsAllDrives: "true" }, body: { trashed: true } });
  const deck = await slides.call<{ presentationId: string; slides: { objectId: string }[] }>("POST", "/presentations", {
    body: { title: input.title },
  });
  await slides.call("POST", `/presentations/${deck.presentationId}:batchUpdate`, {
    body: { requests: thankYouRequests(deck.slides[0].objectId, input.judges).flat() },
  });
  await drive.call("PATCH", `/files/${deck.presentationId}`, { query: { addParents: input.folderId, removeParents: "root", supportsAllDrives: "true" } });
  await drive.call("POST", `/files/${deck.presentationId}/permissions`, {
    query: { sendNotificationEmail: "false", supportsAllDrives: "true" },
    body: { type: "user", role: "writer", emailAddress: input.shareWith },
  });
  return { id: deck.presentationId, url: `https://docs.google.com/presentation/d/${deck.presentationId}/edit` };
}
