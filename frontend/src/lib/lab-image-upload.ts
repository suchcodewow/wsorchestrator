/** Downscales and uploads an image from the browser. */

export type PickerImage = {
  id: string;
  name: string;
  alt: string;
  mimeType: string;
  bytes: number;
  createdAt: string;
};

export const IMAGE_MAX_WIDTH = 2000;

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

export function imageFromTransfer(data: DataTransfer | null): File | null {
  if (!data) return null;

  const dropped = Array.from(data.files).find((f) =>
    f.type.startsWith("image/"),
  );
  if (dropped) return dropped;

  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }

  return null;
}
