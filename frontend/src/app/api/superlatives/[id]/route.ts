/** The signed-in caller's own superlatives survey, with their votes, and voting on it. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { superlativeSubmissionSchema } from "@/lib/surveys/superlative-values";
import { getMySuperlatives, saveMySuperlatives } from "@/lib/surveys/superlatives";

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND = { error: "not_found" } as const;

export async function GET(req: Request, { params }: Params) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const { id } = await params;
  const mine = user.email ? await getMySuperlatives(user.email, id) : null;
  if (!mine) return NextResponse.json(NOT_FOUND, { status: 404 });
  return NextResponse.json(mine);
}

export const PUT = audited(async function PUT(req: Request, { params }: Params) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const parsed = superlativeSubmissionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (!user.email) return NextResponse.json(NOT_FOUND, { status: 404 });

  const { id } = await params;
  const result = await saveMySuperlatives(user.email, id, parsed.data);
  if (!result.ok) {
    const { error: problem } = result;
    if (problem.problem === "not_found") return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ error: problem.problem, superlativeId: problem.superlativeId }, { status: 400 });
  }
  return NextResponse.json(result.survey);
});
