/** Seals and opens a stored secret. */

import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = 1;

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

const HKDF_INFO = "workshop-orchestrator/harness-token/v1";

function key(): Buffer {
  const material = process.env.HARNESS_TOKEN_ENC_KEY ?? process.env.AUTH_SECRET;
  if (!material) {
    throw new Error(
      "Cannot encrypt: set HARNESS_TOKEN_ENC_KEY or AUTH_SECRET.",
    );
  }
  return Buffer.from(
    hkdfSync("sha256", material, "workshop-orchestrator", HKDF_INFO, KEY_BYTES),
  );
}

export function secretsConfigured(): boolean {
  return Boolean(process.env.HARNESS_TOKEN_ENC_KEY ?? process.env.AUTH_SECRET);
}

export function sealSecret(plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

export function openSecret(blob: Buffer): string | null {
  if (blob.length < 1 + IV_BYTES + TAG_BYTES) return null;
  if (blob[0] !== VERSION) return null;

  const iv = blob.subarray(1, 1 + IV_BYTES);
  const tag = blob.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const body = blob.subarray(1 + IV_BYTES + TAG_BYTES);

  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}
