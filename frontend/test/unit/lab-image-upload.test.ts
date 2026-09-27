/**
 * The browser half of adding an image to a guide: pick it out of a paste or a
 * drop, shrink it if it is wider than a page, and post it.
 *
 * Authors paste full-resolution screenshots from retina displays, which are
 * several megabytes each and blow the library's size limit; shrinking them in
 * the browser is what makes a paste just work. It must never make things worse:
 * an animated GIF would lose its animation through a canvas, and a re-encode
 * that comes out bigger, or a browser that cannot decode the file, should hand
 * back the original untouched.
 *
 * The canvas, `createImageBitmap`, `DataTransfer` and `fetch` are browser APIs,
 * replaced here with small fakes that record what they were asked to do.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  IMAGE_MAX_WIDTH,
  downscaleImage,
  imageFromTransfer,
  uploadImageFile,
} from "@/lib/lab-image-upload";

const g = globalThis as Record<string, unknown>;
const STUBBED = ["createImageBitmap", "document", "fetch"] as const;
let saved: Record<string, unknown>;
beforeEach(() => {
  saved = Object.fromEntries(STUBBED.map((k) => [k, g[k]]));
});
afterEach(() => {
  for (const k of STUBBED) {
    if (saved[k] === undefined) delete g[k];
    else g[k] = saved[k];
  }
});

const file = (name: string, type: string, size = 1000) =>
  new File([new Uint8Array(size)], name, { type });

type Canvas = {
  width: number;
  height: number;
  drawn: unknown[][];
  encoded: { type: string; quality: number } | null;
};

/** A browser whose decoded image is `width` × `height` and whose re-encode is `outSize` bytes. */
function fakeBrowser(
  width: number,
  height: number,
  { outSize = 10, context = true, blob = true }: { outSize?: number; context?: boolean; blob?: boolean } = {},
) {
  const state = { closed: 0, decoded: 0, canvas: null as Canvas | null };
  g.createImageBitmap = async () => {
    state.decoded++;
    return { width, height, close: () => state.closed++ };
  };
  g.document = {
    createElement: (tag: string) => {
      assert.equal(tag, "canvas");
      const canvas: Canvas & Record<string, unknown> = {
        width: 0,
        height: 0,
        drawn: [],
        encoded: null,
        getContext: () => (context ? { drawImage: (...args: unknown[]) => canvas.drawn.push(args) } : null),
        toBlob: (done: (b: Blob | null) => void, type: string, quality: number) => {
          canvas.encoded = { type, quality };
          done(blob ? new Blob([new Uint8Array(outSize)], { type }) : null);
        },
      };
      state.canvas = canvas;
      return canvas;
    },
  };
  return state;
}

describe("downscaleImage", () => {
  test("passes a GIF through untouched, without decoding it", async () => {
    const state = fakeBrowser(5000, 5000);
    const gif = file("anim.gif", "image/gif");
    assert.equal(await downscaleImage(gif), gif);
    assert.equal(state.decoded, 0);
  });

  test("passes through a file the browser cannot decode", async () => {
    g.createImageBitmap = async () => {
      throw new Error("InvalidStateError");
    };
    const f = file("x.png", "image/png");
    assert.equal(await downscaleImage(f), f);
  });

  test("leaves an image at or under the width limit alone, and frees the bitmap", async () => {
    for (const width of [100, IMAGE_MAX_WIDTH]) {
      const state = fakeBrowser(width, 500);
      const f = file("x.png", "image/png");
      assert.equal(await downscaleImage(f), f, String(width));
      assert.equal(state.canvas, null);
      assert.equal(state.closed, 1);
    }
  });

  test("scales a wide image to the limit, keeping its aspect ratio", async () => {
    const state = fakeBrowser(4000, 3000);
    const out = await downscaleImage(file("screenshot.png", "image/png"));
    assert.equal(state.canvas?.width, IMAGE_MAX_WIDTH);
    assert.equal(state.canvas?.height, 1500);
    assert.deepEqual(state.canvas?.drawn[0]?.slice(1), [0, 0, IMAGE_MAX_WIDTH, 1500]);
    assert.equal(out.name, "screenshot.png");
    assert.equal(out.type, "image/png");
    assert.equal(out.size, 10);
    assert.equal(state.closed, 1);
  });

  test("rounds the height", async () => {
    const state = fakeBrowser(3000, 1001);
    await downscaleImage(file("x.png", "image/png"));
    assert.equal(state.canvas?.height, 667);
  });

  test("keeps JPEG and WebP, and turns anything else into PNG", async () => {
    const cases: [string, string, string, string][] = [
      ["photo.JPEG", "image/jpeg", "image/jpeg", "photo.jpg"],
      ["photo.jpg", "image/jpeg", "image/jpeg", "photo.jpg"],
      ["pic.webp", "image/webp", "image/webp", "pic.webp"],
      ["scan.bmp", "image/bmp", "image/png", "scan.png"],
      ["noext", "image/png", "image/png", "noext.png"],
      [".png", "image/png", "image/png", "image.png"],
      ["my.shot.v2.tiff", "image/tiff", "image/png", "my.shot.v2.png"],
    ];
    for (const [name, type, outType, outName] of cases) {
      const state = fakeBrowser(4000, 2000);
      const out = await downscaleImage(file(name, type, 100_000));
      assert.equal(state.canvas?.encoded?.type, outType, name);
      assert.equal(state.canvas?.encoded?.quality, 0.92, name);
      assert.equal(out.type, outType, name);
      assert.equal(out.name, outName, name);
    }
  });

  test("keeps the original when the re-encode is no smaller", async () => {
    for (const outSize of [1000, 5000]) {
      fakeBrowser(4000, 2000, { outSize });
      const f = file("x.png", "image/png", 1000);
      assert.equal(await downscaleImage(f), f, String(outSize));
    }
  });

  test("keeps the original when the canvas cannot draw or encode", async () => {
    for (const opts of [{ context: false }, { blob: false }]) {
      const state = fakeBrowser(4000, 2000, opts);
      const f = file("x.png", "image/png");
      assert.equal(await downscaleImage(f), f, JSON.stringify(opts));
      assert.equal(state.closed, 1, "bitmap freed");
    }
  });
});

describe("uploadImageFile", () => {
  type Call = { url: string; init: { method: string; body: FormData } };
  const fakeFetch = (status: number, body: unknown) => {
    const calls: Call[] = [];
    g.fetch = async (url: string, init: Call["init"]) => {
      calls.push({ url, init });
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
          if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
          return body;
        },
      };
    };
    return calls;
  };

  const image = { id: "i", name: "n", alt: "a", mimeType: "image/gif", bytes: 3, createdAt: "t" };

  test("posts the file with only the options given", async () => {
    const calls = fakeFetch(201, { image });
    const gif = file("a.gif", "image/gif", 3);
    assert.deepEqual(await uploadImageFile(gif, { name: "Step 1", autoName: true }), image);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "/api/lab-images");
    assert.equal(calls[0]?.init.method, "POST");
    const body = calls[0]!.init.body;
    assert.equal((body.get("file") as File).name, "a.gif");
    assert.equal(body.get("name"), "Step 1");
    assert.equal(body.get("alt"), null);
    assert.equal(body.get("autoName"), "1");
  });

  test("sends no autoName, name or alt by default", async () => {
    const calls = fakeFetch(201, { image });
    await uploadImageFile(file("a.gif", "image/gif"));
    const body = calls[0]!.init.body;
    assert.deepEqual([...body.keys()], ["file"]);
  });

  test("throws the server's message on failure", async () => {
    fakeFetch(413, { message: "That image is over 5 MB." });
    await assert.rejects(uploadImageFile(file("a.gif", "image/gif")), /That image is over 5 MB\./);
  });

  test("throws the status when the failure has no readable message", async () => {
    fakeFetch(502, undefined);
    await assert.rejects(uploadImageFile(file("a.gif", "image/gif")), /Upload failed \(502\)/);
    fakeFetch(500, { error: "x" });
    await assert.rejects(uploadImageFile(file("a.gif", "image/gif")), /Upload failed \(500\)/);
  });
});

describe("imageFromTransfer", () => {
  type Item = { kind: string; type: string; getAsFile: () => File | null };
  const transfer = (files: File[], items: Item[] = []) =>
    ({ files, items }) as unknown as DataTransfer;
  const item = (kind: string, type: string, f: File | null): Item => ({ kind, type, getAsFile: () => f });

  test("is null for no transfer or an empty one", () => {
    assert.equal(imageFromTransfer(null), null);
    assert.equal(imageFromTransfer(transfer([])), null);
  });

  test("takes the first image among dropped files", () => {
    const txt = file("notes.txt", "text/plain");
    const png = file("a.png", "image/png");
    const jpg = file("b.jpg", "image/jpeg");
    assert.equal(imageFromTransfer(transfer([txt, png, jpg])), png);
  });

  test("falls back to a pasted image item", () => {
    const pasted = file("image.png", "image/png");
    assert.equal(
      imageFromTransfer(transfer([], [item("string", "text/html", null), item("file", "image/png", pasted)])),
      pasted,
    );
  });

  test("skips items that are not image files, or yield no file", () => {
    const later = file("b.webp", "image/webp");
    assert.equal(
      imageFromTransfer(
        transfer(
          [file("a.pdf", "application/pdf")],
          [
            item("string", "image/png", file("x", "image/png")),
            item("file", "text/plain", file("t", "text/plain")),
            item("file", "image/png", null),
            item("file", "image/webp", later),
          ],
        ),
      ),
      later,
    );
  });

  test("is null when nothing is an image", () => {
    assert.equal(
      imageFromTransfer(transfer([file("a.txt", "text/plain")], [item("string", "text/plain", null)])),
      null,
    );
  });
});
