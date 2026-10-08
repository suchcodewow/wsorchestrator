/** One food order's PDF, to open, print or download. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { getFoodOrderFile } from "@/lib/logistics/food-orders";
import { canUseTraining } from "@/lib/roles";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const { id } = await params;
  const file = await getFoodOrderFile(id);
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(file.data.byteLength),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
