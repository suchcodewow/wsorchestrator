/** The lab image library, and uploads into it. */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { LAB_IMAGE_LIMITS } from "@/db/schema";
import { listLabImages, uploadLabImage } from "@/lib/lab-images";
import { canManageLabGuides } from "@/lib/roles";

async function requireEditor() {
  const session = await auth();
  if (!session?.user) {
    return {
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      user: null,
    };
  }
  if (!canManageLabGuides(session.user.siteRole)) {
    return {
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
      user: null,
    };
  }
  return { error: null, user: session.user };
}

export async function GET(req: Request) {
  const { error } = await requireEditor();
  if (error) return error;

  const q = new URL(req.url).searchParams.get("q") ?? "";

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

  if (file.size > LAB_IMAGE_LIMITS.bytes) {
    const { status, message } = UPLOAD_ERRORS.too_large;
    return NextResponse.json({ error: "too_large", message }, { status });
  }

  const name = String(form.get("name") ?? "").trim() || file.name.trim();
  const alt = String(form.get("alt") ?? "").trim();
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
