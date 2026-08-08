import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { LAB_IMAGE_LIMITS } from "@/db/schema";
import { listLabImages, uploadLabImage } from "@/lib/lab-images";
import { canManageLabGuides } from "@/lib/roles";

/** Signed in, and allowed to write guides — the same bar as writing one. */
async function requireEditor() {
  const session = await auth();
  if (!session?.user) {
    return {
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      user: null,
    };
  }
  // Not 401: they are signed in, they just aren't allowed to write guides.
  if (!canManageLabGuides(session.user.siteRole)) {
    return {
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
      user: null,
    };
  }
  return { error: null, user: session.user };
}

/**
 * The image library, for the picker. Managers only.
 *
 * `?q=` narrows by name. The bytes are never in this response — see
 * `@/lib/lab-images` — so a library of fifty screenshots is still a small JSON
 * document, and the picker fetches the images themselves as `<img>` tags the
 * browser can cache.
 */
export async function GET(req: Request) {
  const { error } = await requireEditor();
  if (error) return error;

  const q = new URL(req.url).searchParams.get("q") ?? "";

  // An empty library is `[]` and not an error. The case this catch is here for
  // is a database that has never had `0010_lab_images.sql` applied, where the
  // query throws `relation "lab_images" does not exist` — left unhandled that
  // is a bare 500 with no body, and the picker can only say "500".
  try {
    return NextResponse.json({ images: await listLabImages(q) });
  } catch (err) {
    const missingTable =
      err instanceof Error && /relation .* does not exist/i.test(err.message);

    console.error("lab-images: list failed", err);

    return NextResponse.json(
      {
        error: missingTable ? "not_migrated" : "unavailable",
        message: missingTable
          ? "The image library table is missing — apply the lab_images migration."
          : "The image library could not be read.",
      },
      { status: missingTable ? 503 : 500 },
    );
  }
}

const UPLOAD_ERRORS: Record<string, { status: number; message: string }> = {
  empty: { status: 400, message: "That file is empty." },
  too_large: {
    status: 413,
    message: `Images must be under ${LAB_IMAGE_LIMITS.bytes / (1024 * 1024)} MB.`,
  },
  unsupported_type: {
    status: 415,
    message: "Only PNG, JPEG, GIF and WebP images can be uploaded.",
  },
  corrupt: { status: 400, message: "That file could not be read." },
};

/**
 * Upload an image. Managers only.
 *
 * `multipart/form-data` rather than a JSON body with base64 in it: the file
 * arrives as bytes instead of arriving a third larger as text, and the form is
 * what a file input produces anyway.
 *
 * The name is the author's, and is the only thing they have to supply — it is
 * what the picker searches. An empty one falls back to the filename, because
 * an unnamed image in a library is a thumbnail nobody can find again.
 */
export async function POST(req: Request) {
  const { error, user } = await requireEditor();
  if (error) return error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Checked before the bytes are pulled into memory as well as after: this is
  // the cheap rejection, and `uploadLabImage` is the one that cannot be lied to.
  if (file.size > LAB_IMAGE_LIMITS.bytes) {
    const { status, message } = UPLOAD_ERRORS.too_large;
    return NextResponse.json({ error: "too_large", message }, { status });
  }

  const name = String(form.get("name") ?? "").trim() || file.name.trim();
  const alt = String(form.get("alt") ?? "").trim();
  // Set by the paste handler, whose "filename" is whatever the clipboard
  // invented — `image.png`, for every screenshot anyone ever pastes.
  const autoName = form.get("autoName") === "1";

  const result = await uploadLabImage({
    name: name || "Untitled image",
    alt: alt || name,
    data: Buffer.from(await file.arrayBuffer()),
    authorId: user.id,
    autoName,
  });

  if (!result.ok) {
    const { status, message } = UPLOAD_ERRORS[result.error] ?? {
      status: 400,
      message: "That image could not be uploaded.",
    };
    return NextResponse.json({ error: result.error, message }, { status });
  }

  return NextResponse.json({ image: result.image }, { status: 201 });
}
