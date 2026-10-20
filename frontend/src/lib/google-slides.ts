/**
 * The one-slide "Thank You!" deck the Guest judges tab makes: a title and a
 * grid of the judges' photos, each with a name, sized so all of them fit.
 * `thankYouRequests` is the slide as Slides API `batchUpdate` requests, kept
 * apart from the calls so the layout can be tested without Google.
 */

import "server-only";
import type { CalendarClient } from "@/lib/google-calendar";

export const SLIDES_API = "https://slides.googleapis.com/v1";
export const DRIVE_API = "https://www.googleapis.com/drive/v3";

export type SlideJudge = { name: string; photoUrl: string | null };

const EMU_PER_INCH = 914_400;
const inch = (n: number) => Math.round(n * EMU_PER_INCH);
// Slides' default 16:9 page, 10 x 5.625 inches.
const PAGE = { w: 10, h: 5.625 };
const MARGIN = 0.4;
const TITLE_H = 0.95;

/** The columns and rows that give the largest photo, name included, to `count` judges. */
export function gridFor(count: number): { cols: number; rows: number; cellW: number; cellH: number; photo: number } {
  const areaW = PAGE.w - 2 * MARGIN;
  const areaH = PAGE.h - TITLE_H - MARGIN - 0.1;
  let best = { cols: 1, rows: 1, cellW: areaW, cellH: areaH, photo: 0 };
  for (let cols = 1; cols <= Math.max(1, count); cols++) {
    const rows = Math.ceil(Math.max(1, count) / cols);
    const cellW = areaW / cols;
    const cellH = areaH / rows;
    // A third of the cell's height is left for the name under the photo.
    const photo = Math.min(cellW * 0.86, cellH * 0.68);
    if (photo > best.photo) best = { cols, rows, cellW, cellH, photo };
  }
  return best;
}

/** Requests that replace the new deck's starter slide with the thank-you slide. */
export function thankYouRequests(starterSlideId: string, judges: SlideJudge[]): unknown[] {
  const slideId = "thank_you";
  const requests: unknown[] = [
    { createSlide: { objectId: slideId, slideLayoutReference: { predefinedLayout: "BLANK" } } },
    { deleteObject: { objectId: starterSlideId } },
    textBox("title", slideId, MARGIN, 0.15, PAGE.w - 2 * MARGIN, TITLE_H - 0.15, "Thank You!", 40, true),
  ];
  const { cols, cellW, cellH, photo } = gridFor(judges.length);
  const fontPt = Math.max(6, Math.min(12, Math.floor(photo * 11)));
  judges.forEach((j, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * cellW;
    const y = TITLE_H + row * cellH;
    const px = x + (cellW - photo) / 2;
    if (j.photoUrl) {
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
    }
    requests.push(textBox(`name_${i}`, slideId, x, y + photo + 0.02, cellW, cellH - photo - 0.02, j.name, fontPt, false));
  });
  return requests;
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

/** Makes the deck, shares it with `shareWith`, and gives its link. */
export async function createThankYouDeck(
  slides: CalendarClient,
  drive: CalendarClient,
  input: { title: string; judges: SlideJudge[]; shareWith: string },
): Promise<{ id: string; url: string }> {
  const deck = await slides.call<{ presentationId: string; slides: { objectId: string }[] }>("POST", "/presentations", {
    body: { title: input.title },
  });
  await slides.call("POST", `/presentations/${deck.presentationId}:batchUpdate`, {
    body: { requests: thankYouRequests(deck.slides[0].objectId, input.judges).flat() },
  });
  await drive.call("POST", `/files/${deck.presentationId}/permissions`, {
    query: { sendNotificationEmail: "false" },
    body: { type: "user", role: "writer", emailAddress: input.shareWith },
  });
  return { id: deck.presentationId, url: `https://docs.google.com/presentation/d/${deck.presentationId}/edit` };
}
