import { describe, expect, it } from "vitest";

import {
  decryptJson,
  decryptText,
  encryptJson,
  encryptNullable,
  encryptText,
  isEncryptedValue,
} from "~backend/lib/crypto";

describe("field encryption", () => {
  it("round-trips JSON values", () => {
    for (const value of ["PHPSESSID", 42, [{ name: "server", value: "nginx" }], { nested: [null] }]) {
      expect(decryptJson(encryptJson(value))).toEqual(value);
    }
  });

  it("uses a fresh IV for every value", () => {
    expect(encryptJson("same").$enc).not.toBe(encryptJson("same").$enc);
  });

  it("rejects a tampered ciphertext", () => {
    const sealed = encryptJson("secret");
    const bytes = Buffer.from(sealed.$enc.slice(3), "base64");
    bytes[bytes.length - 1] ^= 1;
    expect(() => decryptJson({ $enc: `v1.${bytes.toString("base64")}` })).toThrow(
      /unable to authenticate/,
    );
  });

  it("leaves null unencrypted and recognizes the marker", () => {
    expect(encryptNullable(null)).toBeNull();
    expect(isEncryptedValue(encryptJson("x"))).toBe(true);
    expect(isEncryptedValue({ $enc: "v1.x", other: 1 })).toBe(false);
    expect(isEncryptedValue("v1.x")).toBe(false);
  });

  it("stores user text encrypted and an empty text as null", () => {
    const sealed = encryptText("owned by the network team");
    expect(isEncryptedValue(sealed)).toBe(true);
    expect(decryptText(sealed)).toBe("owned by the network team");
    expect(encryptText("")).toBeNull();
    expect(decryptText(null)).toBe("");
    expect(() => decryptText("plain text")).toThrow();
    expect(() => decryptText(encryptJson(42))).toThrow();
  });
});
