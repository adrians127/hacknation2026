import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { env } from "~backend/config/env";

/**
 * Field-level encryption at rest (PDF item 16): a sensitive JSON value becomes
 * `{ "$enc": "v1.<base64(iv | tag | ciphertext)>" }`, AES-256-GCM over its JSON text.
 * - An object marker rather than a string prefix: a real header value may start with any text.
 * - A type alias, not an interface: it must stay assignable to Prisma's JSON input types.
 */
export type EncryptedValue = { $enc: string };

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

const key = Buffer.from(env.DATA_ENCRYPTION_KEY, "base64");

export function encryptJson(value: unknown): EncryptedValue {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
  return { $enc: `${VERSION}.${payload}` };
}

/** Throws when the value was tampered with or encrypted under another key. Validate the result. */
export function decryptJson(value: EncryptedValue): unknown {
  const [version, payload = ""] = value.$enc.split(".", 2);
  if (version !== VERSION) {
    throw new Error(`Unsupported encryption version: ${version}`);
  }
  const data = Buffer.from(payload, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, data.subarray(0, IV_BYTES));
  decipher.setAuthTag(data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  const plaintext = Buffer.concat([
    decipher.update(data.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
  const parsed: unknown = JSON.parse(plaintext);
  return parsed;
}

export function isEncryptedValue(value: unknown): value is EncryptedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    typeof (value as Partial<EncryptedValue>).$enc === "string"
  );
}

/** `null` holds nothing sensitive, so it stays a plain `null`. */
export function encryptNullable(value: unknown): EncryptedValue | null {
  return value === null ? null : encryptJson(value);
}

/** Free text written by users (notes). An empty text stores as `null`. */
export function encryptText(text: string): EncryptedValue | null {
  return text === "" ? null : encryptJson(text);
}

/** Reads a column written by `encryptText`; throws if it holds anything else. */
export function decryptText(stored: unknown): string {
  if (stored === null) return "";
  if (!isEncryptedValue(stored)) {
    throw new Error("Expected an encrypted value");
  }
  const text = decryptJson(stored);
  if (typeof text !== "string") {
    throw new Error("Encrypted value is not a text");
  }
  return text;
}
