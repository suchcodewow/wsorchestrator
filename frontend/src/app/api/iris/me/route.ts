/** Someone's own Iris: their track and where they are with each subject; the level only for an Assessments Administrator. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { myIris } from "@/lib/iris/attempts";
import { isForm } from "@/lib/iris/engine";
import { canManageIris, canTakeIris } from "@/lib/roles";

export async function GET(req: Request) {
  const { error, user } = await requireCaller(req, canTakeIris);
  if (error) return error;
  const form = new URL(req.url).searchParams.get("form") ?? "A";
  if (!isForm(form)) return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  return NextResponse.json(await myIris(user.id, form, canManageIris(user.access)));
}
