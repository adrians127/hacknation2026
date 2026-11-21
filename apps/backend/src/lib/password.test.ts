import { describe, expect, it } from "vitest";

import { generateTemporaryPassword, hashPassword, verifyPassword } from "~backend/lib/password";

describe("password hashing", () => {
  it("produces a salted argon2id PHC string that verifies", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");

    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toBe(second);
    expect(await verifyPassword("correct horse battery staple", first)).toBe(true);
    expect(await verifyPassword("correct horse battery stapler", first)).toBe(false);
  });

  it("rejects malformed hashes instead of throwing", async () => {
    expect(await verifyPassword("anything", "plaintext")).toBe(false);
    expect(await verifyPassword("anything", "$argon2i$v=19$m=1,t=1,p=1$AAAA$AAAA")).toBe(false);
  });

  it("generates temporary passwords that satisfy the policy", () => {
    const password = generateTemporaryPassword();

    expect(password).toHaveLength(16);
    expect(generateTemporaryPassword()).not.toBe(password);
  });
});
