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
const BREAKOUT = {
  margin: 0.5,
  titleH: 0.95,
  gap: 0.15,
  /** The leader's size when everything fits, as the Mimir slides set a card's heading; the room and names follow in proportion. */
  maxLeaderPt: 18,
  roomRatio: 0.75,
  nameRatio: 0.72,
  /** Slides' fixed inset inside a shape, and the width one character takes as a fraction of its point size. */
  inset: 0.1,
  /** Extra room under the last name, over the inset every side has. */
  bottomPad: 0.2,
  charW: 0.56,
  background: { red: 0.969, green: 0.969, blue: 0.969 },
  ink: { red: 0.1, green: 0.1, blue: 0.12 },
  muted: { red: 0.33, green: 0.33, blue: 0.36 },
  border: { red: 0.82, green: 0.82, blue: 0.84 },
};

/**
 * The grid and sizes that fit `columns` on the breakout slide: the largest leader size, up to the Mimir slides', at which
 * every name stays on one line and the tallest group fits its card, with the room and names smaller in proportion.
 * `cardH` is as tall as the fullest group needs, so a short list is not a tall empty box.
 */
export function breakoutGrid(columns: BreakoutColumn[]): {
  cols: number;
  rows: number;
  cellW: number;
  cardW: number;
  cardH: number;
  /** Where the cards start down the page: the block of them centred on it, but never up into the title. */
  top: number;
  leaderPt: number;
  roomPt: number;
  namePt: number;
} {
  const count = Math.max(1, columns.length);
  const cols = count <= BREAKOUT_PER_ROW ? count : Math.ceil(count / 2);
  const rows = Math.ceil(count / cols);
  const { margin, gap, inset, charW, bottomPad } = BREAKOUT;
  const cellW = (PAGE.w - 2 * margin + gap) / cols;
  const cellH = (PAGE.h - BREAKOUT.titleH - margin + gap) / rows;
  const cardW = cellW - gap;
  const longest = (texts: string[]) => Math.max(1, ...texts.map((t) => t.length));
  const leaders = longest(columns.map((c) => c.leader));
  const rooms = longest(columns.map((c) => c.room ?? "No room"));
  const names = longest(columns.flatMap((c) => c.people));
  const fullest = Math.max(0, ...columns.map((c) => c.people.length));

  const topFor = (n: number, h: number) => Math.max(BREAKOUT.titleH, (PAGE.h - (n * h + (n - 1) * gap)) / 2);

  for (let leaderPt = BREAKOUT.maxLeaderPt; leaderPt >= MIN_FONT; leaderPt--) {
    const roomPt = Math.round(leaderPt * BREAKOUT.roomRatio * 2) / 2;
    const namePt = Math.round(leaderPt * BREAKOUT.nameRatio * 2) / 2;
    const textW = (cardW - 2 * inset) * 72;
    const wide = Math.max(leaders * leaderPt, rooms * roomPt, names * namePt) * charW;
    const textH = (leaderPt * 1.2 + roomPt * 1.2 + 8 + fullest * (namePt * 1.2 + 2)) / 72 + 2 * inset + bottomPad;
    if (wide <= textW && textH <= cellH - gap)
      return { cols, rows, cellW, cardW, cardH: textH, top: topFor(rows, textH), leaderPt, roomPt, namePt };
  }
  const cardH = cellH - gap;
  return { cols, rows, cellW, cardW, cardH, top: topFor(rows, cardH), leaderPt: MIN_FONT, roomPt: MIN_FONT, namePt: MIN_FONT };
}

const rgb = (color: { red: number; green: number; blue: number }) => ({ opaqueColor: { rgbColor: color } });

/**
 * Requests that replace the new deck's starter slide with a breakout's slide, on the light page the Mimir slides use: the
 * session's name in Georgia, then a white card for each instructor in Geist, their name, their room, and their group beneath.
 */
export function breakoutRequests(starterSlideId: string, title: string, columns: BreakoutColumn[]): unknown[] {
  const slideId = "breakout";
  const { margin, gap, background, ink, muted, border } = BREAKOUT;
  const requests: unknown[] = [
    { createSlide: { objectId: slideId, slideLayoutReference: { predefinedLayout: "BLANK" } } },
    { deleteObject: { objectId: starterSlideId } },
    {
      updatePageProperties: {
        objectId: slideId,
        pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: background } } } },
        fields: "pageBackgroundFill",
      },
    },
    // Slides insets a box's text by 0.1in, so the box starts that much left of the cards for the words to line up with them.
    textBox(
      "title",
      slideId,
      margin - BREAKOUT.inset,
      0.2,
      PAGE.w - 2 * margin,
      BREAKOUT.titleH - 0.2,
      title,
      title.length > 36 ? 24 : 30,
      false,
    ),
    {
      updateTextStyle: {
        objectId: "title",
        style: { fontFamily: "Georgia", foregroundColor: rgb(ink) },
        fields: "fontFamily,foregroundColor",
      },
    },
    { updateParagraphStyle: { objectId: "title", style: { alignment: "START" }, fields: "alignment" } },
  ];
  const { cols, cellW, cardW, cardH, top, leaderPt, roomPt, namePt } = breakoutGrid(columns);
  columns.forEach((c, i) => {
    const id = `card_${i}`;
    const room = c.room ?? "No room";
    const text = [c.leader, room, ...c.people].join("\n");
    const roomStart = c.leader.length + 1;
    const peopleStart = roomStart + room.length + 1;
    const range = (startIndex: number, endIndex: number) => ({ type: "FIXED_RANGE", startIndex, endIndex });
    const style = (startIndex: number, endIndex: number, pt: number, color: typeof ink) => ({
      updateTextStyle: {
        objectId: id,
        textRange: range(startIndex, endIndex),
        style: { fontFamily: "Geist", fontSize: { magnitude: pt, unit: "PT" }, foregroundColor: rgb(color) },
        fields: "fontFamily,fontSize,foregroundColor",
      },
    });
    requests.push(
      {
        createShape: {
          objectId: id,
          shapeType: "ROUND_RECTANGLE",
          elementProperties: {
            pageObjectId: slideId,
            size: { width: { magnitude: inch(cardW), unit: "EMU" }, height: { magnitude: inch(cardH), unit: "EMU" } },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: inch(margin + (i % cols) * cellW),
              translateY: inch(top + Math.floor(i / cols) * (cardH + gap)),
              unit: "EMU",
            },
          },
        },
      },
      {
        updateShapeProperties: {
          objectId: id,
          shapeProperties: {
            shapeBackgroundFill: { solidFill: { color: { rgbColor: { red: 1, green: 1, blue: 1 } } } },
            outline: { outlineFill: { solidFill: { color: { rgbColor: border } } }, weight: { magnitude: 1, unit: "PT" } },
            contentAlignment: "TOP",
          },
          fields: "shapeBackgroundFill,outline,contentAlignment",
        },
      },
      { insertText: { objectId: id, text } },
      { updateParagraphStyle: { objectId: id, style: { alignment: "START" }, fields: "alignment" } },
      style(0, c.leader.length, leaderPt, ink),
      style(roomStart, roomStart + room.length, roomPt, ink),
      {
        updateParagraphStyle: {
          objectId: id,
          textRange: range(roomStart, roomStart + room.length),
          style: { spaceBelow: { magnitude: 8, unit: "PT" } },
          fields: "spaceBelow",
        },
      },
    );
    // A card with nobody assigned has no names to style: an empty range is refused.
    if (c.people.length > 0) {
      requests.push(style(peopleStart, text.length, namePt, muted), {
        updateParagraphStyle: {
          objectId: id,
          textRange: range(peopleStart, text.length),
          style: { spaceBelow: { magnitude: 2, unit: "PT" } },
          fields: "spaceBelow",
        },
      });
    }
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
