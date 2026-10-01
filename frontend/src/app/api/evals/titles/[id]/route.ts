/** Renames, moves or removes one listed title. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import {
  deleteTitle,
  STATUS_FOR,
  updateTitle,
  updateTitleSchema,
} from "@/lib/evals/titles";

const idSchema = z.string().uuid();

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = updateTitleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await updateTitle(id.data, parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, list: result.list },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await deleteTitle(id.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ ok: true });
}
