/**
 * Your conversation with the Mimir coach: reading it, sending it a message or
 * asking it to greet you, and starting over. A send that asks for
 * `text/event-stream` gets the coach's reply as it is written: `text` events
 * carrying each piece, `restart` if the reply begins again on the fallback
 * model, then `done` with the saved turns and your progress, or `error`. Any
 * other send gets the whole reply as JSON once it is finished.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { MIMIR_MESSAGE_MAX } from "@/db/schema";
import { requireUser } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { COACH_STATUS_FOR, beginCoachTurn, finishCoachTurn, getCoachChat, resetCoachChat } from "@/lib/mimir/map/coach";

export async function GET(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const asked = Number.parseInt(new URL(req.url).searchParams.get("before") ?? "", 10);
  return NextResponse.json(await getCoachChat(user.id, Number.isFinite(asked) ? asked : undefined));
}

/** Either something to say, or a request that the coach greet you. */
const sendSchema = z.union([z.object({ message: z.string().trim().min(1).max(MIMIR_MESSAGE_MAX) }), z.object({ open: z.literal(true) })]);

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const parsed = sendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const begun = await beginCoachTurn(user.id, parsed.data);
  if (!begun.ok) return NextResponse.json({ error: begun.error }, { status: COACH_STATUS_FOR[begun.error] });
  noteAudit({ detail: { greeting: "open" in parsed.data } });

  if (!(req.headers.get("accept") ?? "").includes("text/event-stream")) {
    const result = await finishCoachTurn(begun.turn);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: COACH_STATUS_FOR[result.error] });
    noteAudit({ detail: { mastered: result.mastered, recommended: result.recommended, covered: result.covered.map((c) => c.id) } });
    return NextResponse.json({ messages: result.messages, progress: result.progress, mastered: result.mastered, recommended: result.recommended, covered: result.covered });
  }

  noteAudit({ detail: { streamed: true } });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // The reader went away. The reply is still saved, and shows when they come back.
        }
      };
      const result = await finishCoachTurn(begun.turn, { stream: { text: (delta) => send("text", { delta }), restart: () => send("restart", {}) } });
      if (result.ok) {
        send("done", { messages: result.messages, progress: result.progress, mastered: result.mastered, recommended: result.recommended, covered: result.covered });
      } else {
        send("error", { error: result.error, status: COACH_STATUS_FOR[result.error] });
      }
      try {
        controller.close();
      } catch {
        // Already closed by the reader leaving.
      }
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
});

export const DELETE = audited(async function DELETE(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  return NextResponse.json({ ok: true, deleted: await resetCoachChat(user.id) });
});
