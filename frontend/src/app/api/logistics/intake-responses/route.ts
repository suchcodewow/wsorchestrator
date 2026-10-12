/** Each person's latest answers to one intake form, or to both, a page at a time. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { INTAKE_RESPONSE_LIST } from "@/lib/list-specs";
import { responsesFormOf } from "@/lib/logistics/intake-values";
import { answerFilter, listIntakeResponses } from "@/lib/logistics/responses";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const form = responsesFormOf(params.get("form"));
  const { rows, page, hasMore } = await listIntakeResponses(
    form === "all" ? null : form,
    parseListQuery(params, INTAKE_RESPONSE_LIST),
    answerFilter(params),
  );
  return NextResponse.json({ form, responses: rows, page, hasMore });
}
