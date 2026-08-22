import crypto from "node:crypto";
import { logger } from "./logger";

/**
 * Production-grade encryption for API key material.
 *
 *   Algorithm:  AES-256-CBC + HMAC-SHA256 (encrypt-then-MAC, EtM)
 *   IV:         16 random bytes per encryption (never reused)
 *   MAC:        HMAC-SHA256(macKey, iv || ciphertext) → 32 bytes
 *
 *   Wire format:  "v2:" + base64( iv[16] || hmac[32] || ciphertext )
 *
 * The 32-byte master key (from process.env.ENCRYPTION_KEY) is split into two
 * independent subkeys via SHA-256 with domain separation:
 *   • encKey = SHA-256(master || "aes-256-cbc")
 *   • macKey = SHA-256(master || "hmac-sha256")
 *
 * This gives us authenticated encryption (any tampering of iv or ciphertext
 * fails MAC verification) while satisfying the explicit AES-256-CBC requirement.
 *
 *   Key requirements:
 *   • ENCRYPTION_KEY must be set
 *   • Must decode to EXACTLY 32 bytes (accepted formats: base64, hex, or raw)
 *   • Validated at startup via validateEncryptionKey() — server refuses to boot
 *     with an invalid or missing key.
 *
 *   Operational notes:
 *   • Generate one with:  openssl rand -base64 32
 *   • Rotate by re-encrypting all stored ciphertext with the new key
 *     (out of scope here; see migration scripts).
 */

const ALGO = "aes-256-cbc";
const IV_LEN = 16; // AES block size — required by CBC
const MAC_LEN = 32; // HMAC-SHA256 output
const KEY_LEN = 32; // AES-256
const VERSION = "v2";

// Cached subkeys — derived once after validateEncryptionKey() succeeds.
let cachedEncKey: Buffer | null = null;
let cachedMacKey: Buffer | null = null;

/**
 * Decode the master key from any of: base64, hex, or raw 32-char ASCII.
 * Returns a Buffer of EXACTLY 32 bytes, or throws.
 */
function decodeMasterKey(raw: string): Buffer {
  // 1) Try base64 (allow standard, urlsafe, with/without padding)
  try {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === KEY_LEN) return buf;
  } catch {
    /* fall through */
  }
  // 2) Try hex (64 lowercase/uppercase hex chars)
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    const buf = Buffer.from(raw, "hex");
    if (buf.length === KEY_LEN) return buf;
  }
  // 3) Try raw bytes (UTF-8 length must equal 32)
  const utf = Buffer.from(raw, "utf8");
  if (utf.length === KEY_LEN) return utf;

  throw new Error(
    "ENCRYPTION_KEY must decode to exactly 32 bytes. " +
      "Accepted formats: base64 (44 chars), hex (64 chars), or raw 32 ASCII chars. " +
      "Generate one with: openssl rand -base64 32",
  );
}

function deriveSubkeys(master: Buffer): { encKey: Buffer; macKey: Buffer } {
  const encKey = crypto
    .createHash("sha256")
    .update(Buffer.concat([master, Buffer.from("aes-256-cbc")]))
    .digest();
  const macKey = crypto
    .createHash("sha256")
    .update(Buffer.concat([master, Buffer.from("hmac-sha256")]))
    .digest();
  return { encKey, macKey };
}

/**
 * Validate ENCRYPTION_KEY presence and length. MUST be called once at server
 * startup — throws on misconfiguration so the process fails fast instead of
 * accepting financial-grade data with a weak key.
 */
export function validateEncryptionKey(): void {
  const raw = process.env["ENCRYPTION_KEY"];
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is required. " +
        "Generate a 32-byte key with: openssl rand -base64 32",
    );
  }
  const master = decodeMasterKey(raw); // throws on wrong length
  const { encKey, macKey } = deriveSubkeys(master);
  cachedEncKey = encKey;
  cachedMacKey = macKey;
  logger.info(
    { algo: ALGO, ivBytes: IV_LEN, mac: "hmac-sha256", keyBytes: KEY_LEN },
    "Encryption subsystem initialised",
  );
}

function getKeys(): { encKey: Buffer; macKey: Buffer } {
  if (!cachedEncKey || !cachedMacKey) {
    // Lazy init — only happens if validateEncryptionKey() was skipped (e.g. tests).
    validateEncryptionKey();
  }
  return { encKey: cachedEncKey!, macKey: cachedMacKey! };
}

/**
 * Encrypt plaintext UTF-8 with AES-256-CBC + HMAC-SHA256.
 *   Returns:  "v2:" + base64( iv || hmac || ciphertext )
 *   Empty input returns "" so optional fields can be passed through.
 */
export function encrypt(plain: string): string {
  if (!plain) return "";
  const { encKey, macKey } = getKeys();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  // Encrypt-then-MAC over (iv || ciphertext) protects against tampering of either.
  const mac = crypto.createHmac("sha256", macKey).update(iv).update(ciphertext).digest();
  return `${VERSION}:${Buffer.concat([iv, mac, ciphertext]).toString("base64")}`;
}

/**
 * Decrypt a previously encrypted payload. Verifies HMAC in constant time
 * before decrypting — throws on any tampering or wrong key.
 */
export function decrypt(payload: string): string {
  if (!payload) return "";
  if (!payload.startsWith(`${VERSION}:`)) {
    throw new Error(`Unsupported ciphertext format (expected ${VERSION}: prefix)`);
  }
  const buf = Buffer.from(payload.slice(VERSION.length + 1), "base64");
  if (buf.length < IV_LEN + MAC_LEN + 1) {
    throw new Error("Encrypted payload is too short to be valid");
  }
  const iv = buf.subarray(0, IV_LEN);
  const mac = buf.subarray(IV_LEN, IV_LEN + MAC_LEN);
  const ciphertext = buf.subarray(IV_LEN + MAC_LEN);

  const { encKey, macKey } = getKeys();
  const expected = crypto.createHmac("sha256", macKey).update(iv).update(ciphertext).digest();
  if (!crypto.timingSafeEqual(mac, expected)) {
    throw new Error("Ciphertext failed integrity check (bad MAC)");
  }
  const decipher = crypto.createDecipheriv(ALGO, encKey, iv);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}

// Backwards-compatible aliases — older code uses these names.
export const encryptSecret = encrypt;
export const decryptSecret = decrypt;

/**
 * Mask a key for display: shows first 4 + last 4 chars only.
 * Safe to log and to send to clients.
 */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "*".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
