/** Reads and writes the lab image library. */

import { desc, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import {
  LAB_IMAGE_LIMITS,
  LAB_IMAGE_MIME_TYPES,
  labImages,
  type LabImage,
} from "@/db/schema";
import { isUuid } from "@/lib/utils";

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

export async function listLabImages(query = ""): Promise<LabImageSummary[]> {
  const q = query.trim();

  return db
    .select(summary)
    .from(labImages)
    .where(q.length > 0 ? ilike(labImages.name, `%${escapeLike(q)}%`) : undefined)
    .orderBy(desc(labImages.createdAt));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

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

export async function uploadLabImage(input: {
  name: string;
  alt: string;
  data: Buffer;
  authorId: string;
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

export function sniffImageType(
  data: Buffer,
): (typeof LAB_IMAGE_MIME_TYPES)[number] | null {
  if (data.byteLength < 12) return null;

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

  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }

  if (data.subarray(0, 6).toString("latin1").match(/^GIF8[79]a$/)) {
    return "image/gif";
  }

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

  return deleted.length > 0;
}
