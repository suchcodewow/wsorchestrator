import { desc, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import {
  LAB_IMAGE_LIMITS,
  LAB_IMAGE_MIME_TYPES,
  labImages,
  type LabImage,
} from "@/db/schema";
import { isUuid } from "@/lib/utils";

/**
 * Reads and writes for the lab image library.
 *
 * Same shape of access rule as the guides: the *bytes* are readable by anybody,
 * because they are shown on public guide pages, and everything else — the
 * listing, the uploads, the deletes — needs a manager. Nothing here takes a
 * `canEdit`; the routes gate the manager half, and this file is only asked for
 * what the caller is already allowed to have.
 *
 * The bytes are deliberately not part of the listing type. A library of fifty
 * screenshots is several megabytes, and the picker needs names and sizes, not
 * pixels — so `data` is selected only by `getLabImageData`, which serves one
 * image at a time.
 */

/** A row of the picker. Everything except the bytes. */
export type LabImageSummary = Omit<LabImage, "data">;

const summary = {
  id: labImages.id,
  name: labImages.name,
  alt: labImages.alt,
  mimeType: labImages.mimeType,
  bytes: labImages.bytes,
  authorId: labImages.authorId,
  createdAt: labImages.createdAt,
};

/**
 * The image library, newest first, optionally narrowed by name.
 *
 * The search is a case-insensitive substring rather than anything cleverer:
 * an author is looking for the screenshot they called "harness pipeline" and
 * will type "pipe". Wildcards in the query are escaped, so a name containing
 * `%` is searchable and a query of `%` matches nothing rather than everything.
 */
export async function listLabImages(query = ""): Promise<LabImageSummary[]> {
  const q = query.trim();

  return db
    .select(summary)
    .from(labImages)
    .where(q.length > 0 ? ilike(labImages.name, `%${escapeLike(q)}%`) : undefined)
    .orderBy(desc(labImages.createdAt));
}

/** `%`, `_` and `\` are wildcards to LIKE; an author typing them means them. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** One image's bytes and content type, for serving it. Public. */
export async function getLabImageData(
  id: string,
): Promise<{ data: Buffer; mimeType: string } | null> {
  if (!isUuid(id)) return null;

  const [row] = await db
    .select({ data: labImages.data, mimeType: labImages.mimeType })
    .from(labImages)
    .where(eq(labImages.id, id))
    .limit(1);

  return row ?? null;
}

export type UploadLabImageError =
  | "empty"
  | "too_large"
  | "unsupported_type"
  | "corrupt";

/**
 * Store an uploaded image.
 *
 * The declared content type is not trusted. A browser will happily label
 * anything, and this writes to a table whose bytes are later served back from
 * the app's own origin — so the magic bytes decide what this is, and a file
 * whose header does not match a format we accept is refused rather than stored
 * and served as something it is not.
 */
export async function uploadLabImage(input: {
  name: string;
  alt: string;
  data: Buffer;
  authorId: string;
  /** Name was invented by the app, not typed by a person — make it unique. */
  autoName?: boolean;
}): Promise<
  { ok: true; image: LabImageSummary } | { ok: false; error: UploadLabImageError }
> {
  if (input.data.byteLength === 0) return { ok: false, error: "empty" };
  if (input.data.byteLength > LAB_IMAGE_LIMITS.bytes) {
    return { ok: false, error: "too_large" };
  }

  const mimeType = sniffImageType(input.data);
  if (!mimeType) return { ok: false, error: "unsupported_type" };

  const name = input.name.slice(0, LAB_IMAGE_LIMITS.name);

  const [image] = await db
    .insert(labImages)
    .values({
      name: input.autoName ? await availableImageName(name) : name,
      alt: input.alt.slice(0, LAB_IMAGE_LIMITS.alt),
      mimeType,
      bytes: input.data.byteLength,
      data: input.data,
      authorId: input.authorId,
    })
    .returning(summary);

  return { ok: true, image };
}

/**
 * A name nothing else is using, derived from `base`.
 *
 * Only for names the app invented — a person typing "console" twice meant it,
 * and is not owed a number on the end. Pasting eight screenshots into one
 * guide is the case this exists for: without it the library fills with eight
 * rows sharing the guide's title, and the search box cannot tell them apart.
 *
 * Deliberately not a unique constraint. A collision here is a naming
 * inconvenience, not a data error, and a constraint would turn it into a failed
 * upload of an image the author has already lost from their clipboard.
 */
async function availableImageName(base: string): Promise<string> {
  const taken = await db
    .select({ name: labImages.name })
    .from(labImages)
    .where(ilike(labImages.name, `${escapeLike(base)}%`));

  const used = new Set(taken.map((r) => r.name));
  if (!used.has(base)) return base;

  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Rename an image, and re-alt it to match.
 *
 * The two are set together because the picker offers one field: the name is
 * what the library is searched by and the alt is what a screen reader gets,
 * and for a screenshot called "the pipeline after a successful run" those are
 * the same sentence. Guides already referencing the image keep whatever alt
 * text was written into their Markdown at the time — this changes the library
 * entry, not documents that have already quoted it.
 */
export async function renameLabImage(
  id: string,
  name: string,
): Promise<LabImageSummary | null> {
  if (!isUuid(id)) return null;

  const trimmed = name.trim().slice(0, LAB_IMAGE_LIMITS.name);
  if (trimmed.length === 0) return null;

  const [image] = await db
    .update(labImages)
    .set({ name: trimmed, alt: trimmed.slice(0, LAB_IMAGE_LIMITS.alt) })
    .where(eq(labImages.id, id))
    .returning(summary);

  return image ?? null;
}

/**
 * The image format these bytes actually are, or null for anything else.
 *
 * Header sniffing rather than a dependency: there are four formats to
 * recognise and each is a fixed signature in the first twelve bytes. Only the
 * formats in `LAB_IMAGE_MIME_TYPES` are listed, so this doubles as the
 * allow-list — SVG has no magic number and could not be admitted here even by
 * accident, which is the point.
 */
export function sniffImageType(
  data: Buffer,
): (typeof LAB_IMAGE_MIME_TYPES)[number] | null {
  if (data.byteLength < 12) return null;

  // PNG: \x89 P N G \r \n \x1a \n
  if (
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: every variant starts FF D8 FF.
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }

  // GIF: "GIF87a" or "GIF89a".
  if (data.subarray(0, 6).toString("latin1").match(/^GIF8[79]a$/)) {
    return "image/gif";
  }

  // WebP: "RIFF" .... "WEBP" — the four size bytes in between are skipped.
  if (
    data.subarray(0, 4).toString("latin1") === "RIFF" &&
    data.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

export async function deleteLabImage(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;

  const deleted = await db
    .delete(labImages)
    .where(eq(labImages.id, id))
    .returning({ id: labImages.id });

  // Guides that referenced it keep the Markdown; the image simply stops
  // resolving. There is no index from bytes back to the guides mentioning
  // them, so the alternative is a scan of every body on every delete.
  return deleted.length > 0;
}
