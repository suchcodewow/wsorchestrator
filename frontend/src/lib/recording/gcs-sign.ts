/**
 * Cloud Storage V4 signed URLs, without a client library: the canonical
 * request and string to sign, as Google defines them for GOOG4-RSA-SHA256.
 * Signing the string is left to the caller, so this stays pure: on Cloud Run
 * the service account has no key, and Google's IAM signBlob does it.
 *
 * https://cloud.google.com/storage/docs/authentication/signatures
 */

import { createHash } from "node:crypto";

/** RFC 3986: everything but unreserved characters is percent-encoded. */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** An object name in a URL path: each segment encoded, the slashes kept. */
export const encodeObjectPath = (name: string) => name.split("/").map(encodeRfc3986).join("/");

export type SignRequest = {
  method: "GET" | "PUT";
  /** `storage.googleapis.com`, or the emulator's host and port. */
  host: string;
  bucket: string;
  object: string;
  /** The service account the URL is signed as. */
  email: string;
  now: Date;
  expiresSeconds: number;
  /** Extra query parameters, signed with the rest: `response-content-disposition`, say. */
  query?: Record<string, string>;
};

/**
 * The URL without its signature, and the string whose RSA-SHA256 signature,
 * hex-encoded, goes on the end as `X-Goog-Signature`.
 */
export function signingParts(req: SignRequest): { stringToSign: string; unsignedUrl: string } {
  const stamp = req.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); // 20261009T153000Z
  const date = stamp.slice(0, 8);
  const scope = `${date}/auto/storage/goog4_request`;
  const params: Record<string, string> = {
    ...req.query,
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": `${req.email}/${scope}`,
    "X-Goog-Date": stamp,
    "X-Goog-Expires": String(req.expiresSeconds),
    "X-Goog-SignedHeaders": "host",
  };
  const query = Object.keys(params)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(params[k]!)}`)
    .join("&");
  const path = `/${req.bucket}/${encodeObjectPath(req.object)}`;
  const canonicalRequest = [req.method, path, query, `host:${req.host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = [
    "GOOG4-RSA-SHA256",
    stamp,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  return { stringToSign, unsignedUrl: `${path}?${query}` };
}
