import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  deleteLabImage,
  getLabImageData,
  renameLabImage,
} from "@/lib/lab-images";
import { canManageLabGuides } from "@/lib/roles";

/**
 * Serve one image. Public, like the guides that show it.
 *
 * This is the URL that ends up inside the Markdown, so it is the one thing in
 * the image feature a signed-out reader touches. Cached hard and immutably: the
 * bytes at an id never change — an edited screenshot is a new upload with a new
 * id — so a reader who scrolls back up a guide should not re-fetch it, and a
 * room of thirty attendees on the same page should mostly hit their own caches.
 *
 * `Content-Disposition: inline` with a nosniff header is the belt and braces on
 * top of `sniffImageType`: the type was verified from the magic bytes on the
 * way in, and the browser is told not to second-guess it on the way out.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const image = await getLabImageData(id);
  if (!image) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mimeType,
      "Content-Length": String(image.data.byteLength),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

/** Signed in, and allowed to write guides. */
async function requireEditor() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageLabGuides(session.user.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * Rename an image. Managers only.
 *
 * The counterpart to auto-naming: a pasted screenshot is filed under the
 * guide's title because the clipboard offers nothing better, and this is how
 * that gets corrected without the author having to interrupt their writing at
 * the moment of pasting.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireEditor();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : "";
  if (name.trim().length === 0) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { id } = await params;
  const image = await renameLabImage(id, name);
  if (!image) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ image });
}

/**
 * Delete an image. Managers only.
 *
 * Guides that referenced it keep their Markdown and the image stops resolving —
 * there is no index from bytes back to the guides mentioning them, so the
 * alternative is scanning every guide body on every delete.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireEditor();
  if (denied) return denied;

  const { id } = await params;
  if (!(await deleteLabImage(id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
