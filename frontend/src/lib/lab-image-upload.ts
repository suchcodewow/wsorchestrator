/**
 * An image as the API returns it — everything the library stores except the
 * bytes. Defined here rather than in the picker because the upload helper is
 * what produces one, and a component is the wrong place for a shape that two
 * of them and a lib all speak.
 */
export type PickerImage = {
  id: string;
  name: string;
  alt: string;
  mimeType: string;
  bytes: number;
  createdAt: string;
};

/**
 * Client-side half of putting an image in the library: shrink it, then send it.
 *
 * Lives outside the components because two of them do it — the picker's upload
 * button and the editor's paste handler — and an image that arrives by one
 * route should not end up stored differently from one that arrives by the
 * other. Everything here runs in the browser; the server-side counterpart is
 * `@/lib/lab-images`.
 */

/**
 * Widest an image is stored at.
 *
 * A guide's content column is nowhere near this, so the extra pixels buy
 * nothing on screen — but they cost a reader on workshop wifi real seconds,
 * and they cost the database and every backup real megabytes now that the
 * bytes live in Postgres. A modern screenshot is two to four times this wide.
 */
export const IMAGE_MAX_WIDTH = 2000;

/**
 * A smaller version of the file, or the file itself when shrinking it would not
 * help.
 *
 * Deliberately conservative — it declines in more cases than it accepts:
 *
 *  * GIFs are returned untouched. A canvas holds one frame, so re-encoding an
 *    animated GIF silently throws the animation away.
 *  * An image already within the width limit keeps its exact original bytes
 *    rather than being re-encoded for no reason.
 *  * If the re-encoded result is somehow larger than the original, the original
 *    wins. Photographs re-encoded to PNG can be, which is why the source type
 *    is preserved for JPEG and WebP instead of everything becoming PNG.
 *  * Anything the browser cannot decode is passed through, and the server
 *    rejects it on the magic bytes as it would have anyway.
 */
export async function downscaleImage(file: File): Promise<File> {
  if (file.type === "image/gif") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    if (bitmap.width <= IMAGE_MAX_WIDTH) return file;

    const width = IMAGE_MAX_WIDTH;
    const height = Math.round(bitmap.height * (IMAGE_MAX_WIDTH / bitmap.width));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    // PNG for screenshots and anything unrecognised; a photo stays in the
    // lossy format it arrived in rather than ballooning into a PNG.
    const type =
      file.type === "image/jpeg" || file.type === "image/webp"
        ? file.type
        : "image/png";

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, 0.92),
    );
    if (!blob || blob.size >= file.size) return file;

    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    const ext = type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
    return new File([blob], `${base}.${ext}`, { type });
  } finally {
    bitmap.close();
  }
}

/**
 * Upload one image and hand back the stored row.
 *
 * `autoName` marks a name the *app* invented rather than one a person typed —
 * a pasted screenshot has no filename worth keeping — and asks the server to
 * make it unique, so a guide pasted full of screenshots does not produce eight
 * library entries with identical names.
 */
export async function uploadImageFile(
  file: File,
  options: { name?: string; alt?: string; autoName?: boolean } = {},
): Promise<PickerImage> {
  const body = new FormData();
  body.append("file", await downscaleImage(file));
  if (options.name) body.append("name", options.name);
  if (options.alt) body.append("alt", options.alt);
  if (options.autoName) body.append("autoName", "1");

  const res = await fetch("/api/lab-images", { method: "POST", body });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message ?? `Upload failed (${res.status})`);
  }

  const { image } = await res.json();
  return image as PickerImage;
}

/** The image file on a paste or a drop, if there is one. */
export function imageFromTransfer(data: DataTransfer | null): File | null {
  if (!data) return null;

  // Files first: a paste from a screenshot tool, and every drag-and-drop.
  const dropped = Array.from(data.files).find((f) =>
    f.type.startsWith("image/"),
  );
  if (dropped) return dropped;

  // Then clipboard items. Copying an image out of a web page often puts only
  // an HTML flavour and a remote URL here, in which case `getAsFile` is null
  // and the caller lets the normal text paste happen instead.
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }

  return null;
}
