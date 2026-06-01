import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { SessionPayload } from "../types";

/** A long, high-entropy developer code. 256 bits, URL-safe. */
export function generateDevCode(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash a code with the secret as a pepper, so a leaked DB file alone can't be
 * matched offline against guessed codes. */
export function hashCode(secret: string, code: string): string {
  return createHash("sha256").update(`${secret}:${code}`).digest("hex");
}

/** Constant-time string comparison. Both inputs are hashed to fixed-length
 * buffers first, so it never throws on length mismatch and leaks neither
 * length nor content. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function hmac(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/** Sign a stateless session token: `base64url(payload).hmac`. */
export function signSession(secret: string, payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${hmac(secret, body)}`;
}

/** Verify a session token's signature and expiry. Returns the payload or null. */
export function verifySession(secret: string, token: string): SessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!timingSafeEqualStr(sig, hmac(secret, body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

const E2E_SALT = "log-portal-e2e";
const E2E_INFO = "log-portal-e2e-aesgcm-v1";

/** Derive a per-session AES-256-GCM key from the login token, identically on
 * both client and server. The token is the shared secret. */
export function deriveSessionKey(token: string): Buffer {
  return Buffer.from(hkdfSync("sha256", token, E2E_SALT, E2E_INFO, 32));
}

/** AES-256-GCM encrypt. Output is base64 of `iv(12) || ciphertext || tag(16)`,
 * matching the WebCrypto `SubtleCrypto.encrypt` layout (tag appended). */
export function encryptPayload(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

export function decryptPayload(key: Buffer, blob: string): string {
  const data = Buffer.from(blob, "base64");
  const iv = data.subarray(0, 12);
  const tag = data.subarray(data.length - 16);
  const ct = data.subarray(12, data.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
