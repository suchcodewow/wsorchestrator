/** Everything the signed-in caller has been asked to fill in: their registration form, their daily surveys and their Bootcamp's superlatives. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { listMyForms } from "@/lib/surveys/my-forms";

export async function GET(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  return NextResponse.json({ forms: user.email ? await listMyForms(user.email) : [] });
}
