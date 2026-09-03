import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Authenticated encryption for secrets this app has to *use* again.
 *
 * Everything else credential-shaped here is hashed and never recovered — see
 * `@/lib/api-tokens`, where a token this app could print back would be a token a
 * database read hands over. A Harness platform token is the opposite case: it is
 * somebody else's credential, saved so that later work can be done with it, so
 * it has to come back out intact. Encryption is what that costs.
 *
 * AES-256-GCM, one random nonce per sealing, tag included. The tag is why
 * `openSecret` can answer "this blob is not ours" instead of returning garbage:
 * a key that has been rotated produces a failed authentication, not a wrong
 * plaintext that gets sent to Harness.
 */

/** Bumped if the format ever changes; the first byte of every blob. */
const VERSION = 1;

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Ties derived keys to this purpose. If a second kind of secret is ever sealed
 * here it should derive its own key with its own info string, so one leaked
 * plaintext cannot be used to attack the other.
 */
const HKDF_INFO = "workshop-orchestrator/harness-token/v1";

/**
 * The key material, in order of preference:
 *
 *   1. `HARNESS_TOKEN_ENC_KEY` — set this to rotate the key on its own, without
 *      invalidating every browser session in the process.
 *   2. `AUTH_SECRET` — already required, already secret, already deployed. Using
 *      it means this feature needs no new configuration to work, which is the
 *      difference between shipping and waiting on a deploy.
 *
 * Either way it is run through HKDF rather than used directly: `AUTH_SECRET` is
 * a passphrase-shaped string of unknown length, and AES needs exactly 32 bytes
 * of key. The salt is constant — HKDF's salt is about domain separation, not
 * about per-message uniqueness, and the nonce covers that.
 *
 * Derived per call rather than cached at module load: reading the environment
 * lazily is what lets a route answer "not configured" instead of the whole
 * module failing to import.
 */
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

/** Whether a key is available at all, so a page can say so before a form is. */
export function secretsConfigured(): boolean {
  return Boolean(process.env.HARNESS_TOKEN_ENC_KEY ?? process.env.AUTH_SECRET);
}

/** Seal a secret for storage. The blob is `version | iv | tag | ciphertext`. */
export function sealSecret(plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

/**
 * Unseal a blob, or null if it cannot be — wrong key, truncated row, a format
 * from a future version. Null rather than a throw because every caller's
 * recovery is the same: treat the stored token as unusable and ask for it
 * again. Nothing is gained by making each of them write a try/catch to say so.
 */
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
