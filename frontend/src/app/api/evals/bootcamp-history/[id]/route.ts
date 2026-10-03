/** One person's whole bootcamp history row. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEvalsViewer } from "@/lib/api-auth";
import { getHistoryDetail } from "@/lib/evals/bootcamp-history";

const idSchema = z.string().uuid();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireEvalsViewer(req);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  const detail = id.success ? await getHistoryDetail(id.data) : null;
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(detail);
}
