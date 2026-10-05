/** One Canary Wire month, as Reporting → Canary Wire shows it, or as a CSV. */

import { NextResponse } from "next/server";
import { requireCanaryWire } from "@/lib/api-auth";
import { canaryWireView } from "@/lib/canary-wire/store";
import { monthCsv } from "@/lib/canary-wire/view";

export async function GET(req: Request) {
  const { error } = await requireCanaryWire(req);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const format = params.get("format");
  if (format !== null && format !== "csv") {
    return NextResponse.json({ error: "invalid_format" }, { status: 400 });
  }

  const view = await canaryWireView(params.get("month"));
  if (!view) return NextResponse.json({ error: "invalid_month" }, { status: 400 });

  if (format === "csv") {
    const name = `canary-wire-${view.month.toLowerCase().replace(/\s+/g, "-")}.csv`;
    return new Response(monthCsv(view), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  }
  return NextResponse.json(view, { headers: { "cache-control": "no-store" } });
}
