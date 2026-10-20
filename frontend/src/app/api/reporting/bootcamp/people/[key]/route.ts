/**
 * One person's BTC and INT: what a manager sees, and for an Assessments Viewer
 * every assessment behind it, scores and comments. 404 for someone the caller
 * may not see.
 */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { getBootcampPerson, readerOf } from "@/lib/reporting/bootcamp";
import { canSeeBootcampRecords } from "@/lib/roles";

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { error, user } = await requireCaller(req, canSeeBootcampRecords);
  if (error) return error;

  const person = await getBootcampPerson(readerOf(user), (await params).key);
  if (!person) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(person);
}
