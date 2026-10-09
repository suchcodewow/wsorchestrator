/**
 * Answering a request for one finished stream: a redirect to a signed URL
 * when it is in the bucket, so the video never passes through the app, or
 * its bytes from disk, honouring a Range header. Shared by the Training
 * administrators' route and the recorder's own, which differ only in who
 * may ask.
 */

import "server-only";

import { NextResponse } from "next/server";
import { openRecordingFile } from "./recordings";
import { videoContentType } from "./video";

/** `bytes=start-end`, `bytes=start-` or `bytes=-suffix`, clamped to the file; null for anything else. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "") || size === 0) return null;
  const start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(size - 1, Number(m[2]));
  return start <= end && start < size ? { start, end } : null;
}

export async function serveTrackFile(req: Request, takeId: string, kind: string, download: boolean): Promise<Response> {
  let opened: Awaited<ReturnType<typeof openRecordingFile>>;
  try {
    opened = await openRecordingFile(takeId, kind, {
      download,
      pickRange: (size) => parseRange(req.headers.get("range"), size),
    });
  } catch (err) {
    console.error("recording: download URL failed", err);
    return NextResponse.json({ error: "signing_failed" }, { status: 503 });
  }
  if (!opened) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { file, name, mimeType } = opened;
  if ("redirect" in file) {
    return new Response(null, { status: 302, headers: { Location: file.redirect, "Cache-Control": "private, no-store" } });
  }

  const headers: Record<string, string> = {
    "Content-Type": videoContentType(mimeType),
    "Accept-Ranges": "bytes",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
  if (file.range) {
    headers["Content-Range"] = `bytes ${file.range.start}-${file.range.end}/${file.bytes}`;
    headers["Content-Length"] = String(file.range.end - file.range.start + 1);
    return new Response(file.stream, { status: 206, headers });
  }
  headers["Content-Length"] = String(file.bytes);
  return new Response(file.stream, { headers });
}
