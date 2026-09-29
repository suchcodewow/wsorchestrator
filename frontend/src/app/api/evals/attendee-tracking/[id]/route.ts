/** Edits or removes one person's bootcamp history. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import {
  deleteHistory,
  historyPatchSchema,
  STATUS_FOR,
  updateHistory,
} from "@/lib/evals/bootcamp-history";

const idSchema = z.string().uuid();

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, user } = await requireEvalsAdministrator();
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = historyPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await updateHistory(user.id, id.data, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS_FOR[result.error] });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireEvalsAdministrator();
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success || !(await deleteHistory(id.data))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
