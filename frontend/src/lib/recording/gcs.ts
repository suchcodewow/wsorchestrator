/**
 * The handful of Cloud Storage calls recordings need, over the JSON API with
 * the app's own credentials: list, compose, delete and size, plus V4 signed
 * URLs so the participant's browser uploads straight to the bucket and an
 * administrator's downloads come straight from it. Neither passes through the
 * app, so neither costs it memory, Cloud Run's request limits, or an audit
 * row per chunk.
 *
 * `STORAGE_EMULATOR_HOST` (`http://localhost:4443`) points every call at
 * fake-gcs-server instead, unauthenticated; it accepts a signed URL without
 * checking the signature, so the same code runs against it.
 */

import "server-only";

import { GoogleAuth } from "google-auth-library";
import { encodeRfc3986, signingParts } from "./gcs-sign";

const SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";

/** Sources one compose call takes. */
export const COMPOSE_LIMIT = 32;

const emulator = () => process.env.STORAGE_EMULATOR_HOST?.replace(/\/$/, "") || null;
const origin = () => emulator() ?? "https://storage.googleapis.com";

let auth: GoogleAuth | null = null;
const googleAuth = () => (auth ??= new GoogleAuth({ scopes: [SCOPE] }));

async function headers(): Promise<Record<string, string>> {
  if (emulator()) return {};
  const token = await googleAuth().getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

/** The emulator starts empty; make the bucket on first use there. A real bucket is Terraform's. */
const madeInEmulator = new Set<string>();
async function ensureEmulatorBucket(path: string) {
  const bucket = /^\/b\/([^/?]+)/.exec(path)?.[1];
  if (!emulator() || !bucket || madeInEmulator.has(bucket)) return;
  await fetch(`${origin()}/storage/v1/b`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: decodeURIComponent(bucket) }),
  });
  madeInEmulator.add(bucket);
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  await ensureEmulatorBucket(path);
  const res = await fetch(`${origin()}/storage/v1${path}`, {
    ...init,
    headers: { ...(await headers()), ...(init.headers as Record<string, string>) },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Cloud Storage ${init.method ?? "GET"} ${path.split("?")[0]} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

const objectPath = (bucket: string, name: string) => `/b/${encodeRfc3986(bucket)}/o/${encodeRfc3986(name)}`;

/** Every object under `prefix`, with its size, a page of up to 1,000 at a time until done. */
export async function listObjects(bucket: string, prefix: string): Promise<{ name: string; size: number }[]> {
  const out: { name: string; size: number }[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ prefix, fields: "nextPageToken,items(name,size)" });
    if (pageToken) query.set("pageToken", pageToken);
    const res = await call(`/b/${encodeRfc3986(bucket)}/o?${query}`);
    const body = (await res.json()) as { items?: { name: string; size: string }[]; nextPageToken?: string };
    for (const item of body.items ?? []) out.push({ name: item.name, size: Number(item.size) });
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

/** Joins up to 32 objects, in order, into `destination`. */
export async function compose(bucket: string, sources: string[], destination: string, contentType: string): Promise<void> {
  if (sources.length === 0 || sources.length > COMPOSE_LIMIT) throw new Error(`compose takes 1 to ${COMPOSE_LIMIT} sources, not ${sources.length}`);
  await call(`${objectPath(bucket, destination)}/compose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceObjects: sources.map((name) => ({ name })), destination: { contentType } }),
  });
}

/** An object's size, or null if it is not there. */
export async function objectSize(bucket: string, name: string): Promise<number | null> {
  const res = await call(`${objectPath(bucket, name)}?fields=size`);
  if (res.status === 404) return null;
  return Number(((await res.json()) as { size: string }).size);
}

/** Deletes an object; one already gone is not an error. */
export async function deleteObject(bucket: string, name: string): Promise<void> {
  await call(objectPath(bucket, name), { method: "DELETE" });
}

/**
 * A V4 signed URL for one object. Against the emulator the signature is a
 * placeholder, which it does not check; against Cloud Storage the app's
 * service account signs it — with its key if it has one, else through IAM
 * signBlob, which needs Service Account Token Creator on itself.
 */
export async function signedUrl(input: {
  method: "GET" | "PUT";
  bucket: string;
  object: string;
  expiresSeconds: number;
  query?: Record<string, string>;
}): Promise<string> {
  const emu = emulator();
  const host = emu ? new URL(emu).host : "storage.googleapis.com";
  const email = emu ? "emulator@recordings.local" : (await googleAuth().getCredentials()).client_email;
  if (!email) throw new Error("The app's credentials name no service account to sign recording URLs as.");
  if (emu) await ensureEmulatorBucket(`/b/${encodeRfc3986(input.bucket)}`);
  const { stringToSign, unsignedUrl } = signingParts({ ...input, host, email, now: new Date() });
  const signature = emu ? "0".repeat(64) : Buffer.from(await googleAuth().sign(stringToSign), "base64").toString("hex");
  return `${origin()}${unsignedUrl}&X-Goog-Signature=${signature}`;
}
