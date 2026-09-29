/** Saves or forgets the HiBob service user eVals imports employees with. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import {
  connectionInputSchema,
  deleteHibobConnection,
  saveHibobConnection,
  STATUS_FOR,
} from "@/lib/evals/hibob";

export async function PUT(req: Request) {
  const { error, user } = await requireEvalsAdministrator();
  if (error) return error;

  const parsed = connectionInputSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await saveHibobConnection(user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const { error } = await requireEvalsAdministrator();
  if (error) return error;

  await deleteHibobConnection();
  return NextResponse.json({ ok: true });
}
