/** Imports a Bootcamp_History sheet (.xlsx or .csv) into attendee tracking. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { importHistory, STATUS_FOR } from "@/lib/evals/bootcamp-history";

export async function POST(req: Request) {
  const { error, user } = await requireEvalsAdministrator();
  if (error) return error;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "malformed" }, { status: 400 });

  const file = form.get("file");
  const result = await importHistory(user.id, file instanceof File ? file : null);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json(result.summary);
}
