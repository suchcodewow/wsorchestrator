/**
 * Converting a Google slide into one of the presentation's own pages, which
 * then stands in for it. The deck itself is never written to: the work is done
 * in a copy of it, made in the connected account's Drive and trashed at the end
 * whatever happens. The copy is cut down to the slide and exported as
 * PowerPoint, to read the order the slide's animations reveal things in. The
 * slide stripped of its live elements is then drawn by Google as the page's
 * background. Each live element gets two copies of the slide holding it alone,
 * on solid black and on solid white, with nothing its layout or master draws;
 * from Google's two pictures of it come its own pixels and how opaque each one
 * is, so it is cut out exactly as Google draws it, edges, shadow and
 * translucency included, with nothing of what lay behind it, and placed where
 * it stood.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { DRIVE_API } from "@/lib/google-slides";
import { unzip } from "@/lib/spreadsheet-file";
import {
  animationPlan,
  backdropRequests,
  copyId,
  isolationRequests,
  liftable,
  unmatte,
  type AnimationPlan,
  type ApiBackdropPage,
  type ApiElement,
} from "./convert-plan";
import { slidePng, withGoogle, type DeckFailure } from "./google";
import { newElement, STAGE, type PageDocument, type PageElement } from "./page";

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const ASSET_QUALITY = 92;
/** Requests sent to one batchUpdate at a time; a busy slide's isolation runs to thousands. */
const BATCH_SIZE = 500;

export type ConvertedAsset = { id: string; image: Buffer; width: number; height: number };

export type Conversion = {
  document: PageDocument;
  assets: ConvertedAsset[];
  /** Elements made live, and how many of them Google's animations reveal. */
  live: number;
  animated: number;
  /** False when the deck could not be exported to read its animations, so every element is simply shown. */
  animationsRead: boolean;
};

/** Google's pictures of a slide: stripped of its live elements, and each live element alone on black and on white. */
export type Rendered = {
  base: Buffer;
  mattes: { black: Buffer; white: Buffer }[];
  elements: ApiElement[];
  lifted: number[];
  plan: AnimationPlan;
  animationsRead: boolean;
};

type ApiLayout = ApiBackdropPage & { objectId: string; layoutProperties?: { masterObjectId?: string } };

/** The pictures Google draws of the slide and its live elements, from a scratch copy of the deck; null if the deck no longer has the slide. */
function renderInCopy(fileId: string, pageId: string) {
  return withGoogle(async ({ slides, drive, token }): Promise<Rendered | null> => {
    const id = encodeURIComponent(fileId);
    const deck = await slides.call<{
      pageSize: { width: { magnitude: number }; height: { magnitude: number } };
      slides: { objectId: string; slideProperties?: { layoutObjectId?: string; masterObjectId?: string } }[];
      layouts?: ApiLayout[];
      masters?: (ApiBackdropPage & { objectId: string })[];
    }>("GET", `/presentations/${id}`, {
      query: {
        fields:
          "pageSize,slides(objectId,slideProperties(layoutObjectId,masterObjectId))," +
          "layouts(objectId,layoutProperties(masterObjectId),pageElements(objectId,shape(placeholder)))," +
          "masters(objectId,pageElements(objectId,shape(placeholder)))",
      },
    });
    const slide = deck.slides.find((s) => s.objectId === pageId);
    if (!slide) return null;
    const page = await slides.call<{ pageElements?: ApiElement[] }>("GET", `/presentations/${id}/pages/${encodeURIComponent(pageId)}`, {
      query: { fields: "pageElements(objectId,size,transform,elementGroup)" },
    });
    const elements = page.pageElements ?? [];
    const size = { width: deck.pageSize.width.magnitude, height: deck.pageSize.height.magnitude };
    const layout = deck.layouts?.find((l) => l.objectId === slide.slideProperties?.layoutObjectId);
    const masterId = slide.slideProperties?.masterObjectId ?? layout?.layoutProperties?.masterObjectId;
    const master = deck.masters?.find((m) => m.objectId === masterId);

    const copy = await drive.call<{ id: string }>("POST", `/files/${id}/copy`, {
      query: { supportsAllDrives: "true", fields: "id" },
      body: { name: `Presentation conversion (temporary, safe to delete) ${pageId}`, parents: ["root"] },
    });
    try {
      const batch = async (requests: unknown[]) => {
        for (let i = 0; i < requests.length; i += BATCH_SIZE) {
          await slides.call("POST", `/presentations/${encodeURIComponent(copy.id)}:batchUpdate`, {
            body: { requests: requests.slice(i, i + BATCH_SIZE) },
          });
        }
      };

      // Down to the one slide, and its own layout: small enough for Drive's 10 MB export limit.
      await batch(deck.slides.filter((s) => s.objectId !== pageId).map((s) => ({ deleteObject: { objectId: s.objectId } })));
      await batch(
        (deck.layouts ?? []).filter((l) => l.objectId !== layout?.objectId).map((l) => ({ deleteObject: { objectId: l.objectId } })),
      ).catch(() => null);

      let plan: AnimationPlan = new Map();
      let animationsRead = false;
      try {
        const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(copy.id)}/export?mimeType=${encodeURIComponent(PPTX)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(60_000),
          cache: "no-store",
        });
        const xml = res.ok
          ? unzip(Buffer.from(await res.arrayBuffer()))
              .get("ppt/slides/slide1.xml")
              ?.toString("utf8")
          : undefined;
        if (xml) {
          plan = animationPlan(xml);
          animationsRead = true;
        }
      } catch {
        // Without the export the elements are still made live, only not revealed in Google's order.
      }

      const lifted = liftable(elements, size, new Set(plan.keys()));
      await batch(isolationRequests(pageId, elements, lifted));
      // The background keeps what the layout and master draw; the copies that follow must not.
      const base = await slidePng(slides, copy.id, pageId);
      await batch(backdropRequests([layout, master].flatMap((p) => (p ? [p] : []))));
      const mattes: Rendered["mattes"] = [];
      for (let k = 0; k < lifted.length; k++) {
        mattes.push({
          black: await slidePng(slides, copy.id, copyId(pageId, k, "black")),
          white: await slidePng(slides, copy.id, copyId(pageId, k, "white")),
        });
      }
      return { base, mattes, elements, lifted, plan, animationsRead };
    } finally {
      await drive
        .call("PATCH", `/files/${encodeURIComponent(copy.id)}`, { query: { supportsAllDrives: "true" }, body: { trashed: true } })
        .catch(() => undefined);
    }
  });
}

/** The slide `pageId` of deck `fileId` as a page of live elements over its background; nothing is stored. */
export async function convertSlide(
  fileId: string,
  pageId: string,
): Promise<{ ok: true; conversion: Conversion } | DeckFailure | { ok: false; error: "not_found" }> {
  const rendered = await renderInCopy(fileId, pageId);
  if (!rendered.ok) return rendered;
  if (!rendered.value) return { ok: false, error: "not_found" };
  return cutOut(rendered.value);
}

/** Google's pictures of a slide made into a page: its background, and each live element cut from its two pictures alone and put where it stood. */
export async function cutOut({
  base,
  mattes,
  elements,
  lifted,
  plan,
  animationsRead,
}: Rendered): Promise<{ ok: true; conversion: Conversion } | { ok: false; error: "failed"; message: string }> {
  const { width, height } = await sharp(base).metadata();
  if (!width || !height) return { ok: false, error: "failed", message: "Google's picture of the slide could not be read." };
  const scale = STAGE.width / width;
  const rgb = (png: Buffer) => sharp(png).removeAlpha().resize(width, height, { fit: "fill" }).raw().toBuffer();

  const backgroundAsset: ConvertedAsset = {
    id: randomUUID(),
    image: await sharp(base).webp({ quality: ASSET_QUALITY }).toBuffer(),
    width,
    height,
  };
  const assets = [backgroundAsset];
  const live: PageElement[] = [];
  for (const [k, index] of lifted.entries()) {
    const { rgba, box } = unmatte(await rgb(mattes[k]!.black), await rgb(mattes[k]!.white), width, height);
    // Nothing of it shows (an empty placeholder, say): nothing to cut.
    if (!box) continue;
    const asset: ConvertedAsset = {
      id: randomUUID(),
      image: await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } })
        .extract(box)
        .webp({ quality: ASSET_QUALITY, alphaQuality: 100 })
        .toBuffer(),
      width: box.width,
      height: box.height,
    };
    assets.push(asset);
    const reveal = plan.get(index);
    live.push({
      ...newElement("image", elements[index]!.objectId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || `e${k}`),
      x: Math.round(box.left * scale),
      y: Math.round(box.top * scale),
      w: Math.round(box.width * scale),
      h: Math.round(box.height * scale),
      fill: null,
      text: "",
      src: asset.id,
      // Step 0 plays as the slide opens; the rest wait for their clicks.
      reveal: !reveal
        ? null
        : reveal.step === 0
          ? { on: "enter", delay: reveal.delay ?? 0, effect: reveal.effect }
          : { on: "next", order: reveal.step, effect: reveal.effect },
    });
  }

  return {
    ok: true,
    conversion: {
      document: { background: "#000000", backgroundImage: backgroundAsset.id, elements: live },
      assets,
      live: live.length,
      animated: live.filter((el) => el.reveal).length,
      animationsRead,
    },
  };
}
