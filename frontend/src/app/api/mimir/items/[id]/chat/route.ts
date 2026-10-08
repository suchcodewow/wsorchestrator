/**
 * Your coaching conversation about one Mimir item: reading it, sending the
 * coach a message, and starting over. A send that asks for
 * `text/event-stream` gets the coach's reply as it is written: `text` events
 * carrying each piece, `restart` if the reply begins again on the fallback
 * model, then `done` with the saved turns or `error`. Any other send gets the
 * whole reply as JSON once it is finished.
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { CHAT_STATUS_FOR, beginTurn, finishTurn, getChat, messageSchema, resetChat } from "@/lib/mimir/chat";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const asked = Number.parseInt(new URL(req.url).searchParams.get("before") ?? "", 10);
  const chat = await getChat(user.id, (await params).id, Number.isFinite(asked) ? asked : undefined);
  if ("error" in chat) return NextResponse.json({ error: chat.error }, { status: CHAT_STATUS_FOR[chat.error] });
  return NextResponse.json(chat);
}

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const parsed = messageSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const begun = await beginTurn(user.id, (await params).id, parsed.data.message);
  if (!begun.ok) return NextResponse.json({ error: begun.error }, { status: CHAT_STATUS_FOR[begun.error] });

  if (!(req.headers.get("accept") ?? "").includes("text/event-stream")) {
    const result = await finishTurn(begun.turn);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: CHAT_STATUS_FOR[result.error] });
    noteAudit({ detail: { masteryReady: result.masteryReady } });
    return NextResponse.json({ messages: result.messages, masteryReady: result.masteryReady, tier: result.tier });
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
      const result = await finishTurn(begun.turn, {
        stream: { text: (delta) => send("text", { delta }), restart: () => send("restart", {}) },
      });
      if (result.ok) {
        send("done", { messages: result.messages, masteryReady: result.masteryReady, tier: result.tier });
      } else {
        send("error", { error: result.error, status: CHAT_STATUS_FOR[result.error] });
      }
      try {
        controller.close();
      } catch {
        // Already closed by the reader leaving.
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});

export const DELETE = audited(async function DELETE(req: Request, { params }: Params) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  return NextResponse.json({ ok: true, deleted: await resetChat(user.id, (await params).id) });
});
