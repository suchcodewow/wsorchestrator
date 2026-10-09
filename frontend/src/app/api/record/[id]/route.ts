/** Whether a recording link can take a new recording: it is the one in use. */

import { NextResponse } from "next/server";
import { isActiveLink } from "@/lib/recording/recordings";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await isActiveLink(id))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ id });
}
