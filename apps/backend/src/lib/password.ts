import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Built into Node (>= 24.7): no native addon to compile in Docker or allow in pnpm.
const deriveKey = promisify(argon2);

// OWASP minimum for argon2id: 19 MiB, 2 passes, 1 lane (~25 ms per hash here).
const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
const SALT_BYTES = 16;

const PHC_PATTERN = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

// PHC strings use unpadded standard base64.
const toB64 = (buffer: Buffer) => buffer.toString("base64").replace(/=+$/, "");

/** argon2id hash in PHC format: `$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await deriveKey("argon2id", { message: password, nonce: salt, ...PARAMS });
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const match = PHC_PATTERN.exec(phc);
  if (!match) return false;
  const [, memory, passes, parallelism, salt = "", expectedB64 = ""] = match;
  const expected = Buffer.from(expectedB64, "base64");

  const actual = await deriveKey("argon2id", {
    message: password,
    nonce: Buffer.from(salt, "base64"),
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: expected.length,
  });
  return timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same time as a real check, for logins that fail before any password
 * is compared (unknown email, locked account), so timing does not reveal which.
 */
export async function verifyAgainstDummyHash(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await dummyHash);
  return false;
}

/** 16 URL-safe characters (96 bits), shown to an admin once. */
export function generateTemporaryPassword(): string {
  return randomBytes(12).toString("base64url");
}
