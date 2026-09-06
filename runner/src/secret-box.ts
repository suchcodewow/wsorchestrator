import { createDecipheriv, hkdfSync } from "node:crypto";

/**
 * Reading secrets the app sealed — the decrypt half of the frontend's
 * `src/lib/secret-box.ts`, and deliberately only that half.
 *
 * The runner never writes one of these. An administrator types an org secret's
 * value into the app, the app seals it, and the runner opens it long enough to
 * hand the value to Harness. So there is no `sealSecret` here: a runner that
 * could write one would be a second place capable of minting these blobs, with
 * a second chance to get the format wrong.
 *
 * The format and every constant below have to match the frontend exactly —
 * version byte, nonce length, tag length, HKDF salt and info. They are copied
 * rather than shared because these are two separately deployed services with no
 * common package between them, and a duplicated 20 lines is a cheaper coupling
 * than a shared build. If the frontend's version byte ever changes, this file
 * changes with it.
 */

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HKDF_INFO = "workshop-orchestrator/harness-token/v1";

/**
 * The key material, in the same order of preference the app uses:
 * `HARNESS_TOKEN_ENC_KEY` if the deployment rotated the key on its own, else
 * `AUTH_SECRET`. Read lazily so a runner with neither can still say what it is
 * missing rather than failing to start.
 */
function key(): Buffer {
  const material = process.env.HARNESS_TOKEN_ENC_KEY ?? process.env.AUTH_SECRET;
  if (!material) {
    throw new Error(
      "cannot decrypt stored secrets: set HARNESS_TOKEN_ENC_KEY or AUTH_SECRET",
    );
  }
  return Buffer.from(
    hkdfSync("sha256", material, "workshop-orchestrator", HKDF_INFO, KEY_BYTES),
  );
}

/** Whether a key is available at all, so a caller can say so before it tries. */
export function secretsConfigured(): boolean {
  return Boolean(process.env.HARNESS_TOKEN_ENC_KEY ?? process.env.AUTH_SECRET);
}

/**
 * Unseal a blob, or null if it cannot be — wrong key, truncated row, a format
 * from a future version. Null rather than a throw because the caller's recovery
 * is the same in every case: the value cannot be used, and saying which row it
 * was is more useful than a stack trace.
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
