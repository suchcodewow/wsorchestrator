/** The tour a page plays, and whether the caller has seen this version of it. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { canEditTour } from "@/lib/nav";
import { normalizePath } from "@/lib/tours/pattern";
import { tourForPath } from "@/lib/tours/tours";

export async function GET(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;
  const asked = new URL(req.url).searchParams.get("path") ?? "";
  if (!asked.startsWith("/")) return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  const path = normalizePath(asked);

  const found = await tourForPath(path, user.id);
  return NextResponse.json({
    tour: found?.tour ?? null,
    seenVersion: found?.seenVersion ?? 0,
    canEdit: canEditTour(user.access, path),
  });
}
