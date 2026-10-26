/**
 * The recordings bucket, as the studio uses it: read and write whole objects,
 * list a prefix, delete. The JSON API over fetch, like the app's
 * `lib/recording/gcs.ts`, and `STORAGE_EMULATOR_HOST` points it at
 * fake-gcs-server the same way.
 */

import { GoogleAuth } from "google-auth-library";

const emulator = () => process.env.STORAGE_EMULATOR_HOST?.replace(/\/$/, "") || null;
const origin = () => emulator() ?? "https://storage.googleapis.com";

export function bucket(): string {
  const b = process.env.RECORDINGS_BUCKET;
  if (!b) throw new Error("RECORDINGS_BUCKET is not set");
  return b;
}

let auth: GoogleAuth | null = null;
async function headers(): Promise<Record<string, string>> {
  if (emulator()) return {};
  auth ??= new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/devstorage.read_write"] });
  return { Authorization: `Bearer ${await auth.getAccessToken()}` };
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

let emulatorBucketMade = false;
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  if (emulator() && !emulatorBucketMade) {
    await fetch(`${origin()}/storage/v1/b`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: bucket() }) });
    emulatorBucketMade = true;
  }
  const res = await fetch(`${origin()}${path}`, { ...init, headers: { ...(await headers()), ...(init.headers as Record<string, string>) } });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Cloud Storage ${init.method ?? "GET"} ${path.split("?")[0]} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

const objectPath = (name: string) => `/storage/v1/b/${enc(bucket())}/o/${enc(name)}`;

/** An object's bytes, or null if it is not there. */
export async function download(name: string): Promise<Buffer | null> {
  const res = await call(`${objectPath(name)}?alt=media`);
  if (res.status === 404) return null;
  return Buffer.from(await res.arrayBuffer());
}

export async function upload(name: string, body: Buffer, contentType: string): Promise<void> {
  await call(`/upload/storage/v1/b/${enc(bucket())}/o?uploadType=media&name=${enc(name)}`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(body),
  });
}

/** Every object name under `prefix`. */
export async function list(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ prefix, fields: "nextPageToken,items(name)" });
    if (pageToken) query.set("pageToken", pageToken);
    const res = await call(`/storage/v1/b/${enc(bucket())}/o?${query}`);
    const body = (await res.json()) as { items?: { name: string }[]; nextPageToken?: string };
    for (const item of body.items ?? []) out.push(item.name);
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

/** Deletes an object; one already gone is not an error. */
export async function remove(name: string): Promise<void> {
  await call(objectPath(name), { method: "DELETE" });
}

/** The content type an object should be stored with, from its name. */
export function contentTypeOf(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const types: Record<string, string> = {
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    jpg: "image/jpeg",
    png: "image/png",
    json: "application/json",
    txt: "text/plain; charset=utf-8",
    tsx: "text/plain; charset=utf-8",
    md: "text/markdown; charset=utf-8",
  };
  return types[ext] ?? "application/octet-stream";
}
