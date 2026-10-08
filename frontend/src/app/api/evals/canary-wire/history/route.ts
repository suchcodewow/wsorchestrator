/** The Canary Wire month over month, as Reporting → Canary Wire History shows it, or as a CSV. */

import { NextResponse } from "next/server";
import { requireCanaryWire } from "@/lib/api-auth";
import { historyCsv } from "@/lib/canary-wire/history";
import { scopeFor } from "@/lib/canary-wire/scope";
import { canaryWireHistory } from "@/lib/canary-wire/store";

export async function GET(req: Request) {
  const { error, user } = await requireCanaryWire(req);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const whose = scopeFor(user, params.get("scope"));
  if (!whose.ok) return NextResponse.json({ error: whose.error }, { status: 400 });
  const format = params.get("format");
  if (format !== null && format !== "csv") {
    return NextResponse.json({ error: "invalid_format" }, { status: 400 });
  }

  const history = await canaryWireHistory(whose.scope);
  if (format === "csv") {
    const name = `canary-wire-history${history.scope === "org" ? "-my-org" : ""}.csv`;
    return new Response(historyCsv(history), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  }
  return NextResponse.json(history, { headers: { "cache-control": "no-store" } });
}
