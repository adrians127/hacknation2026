import { describe, expect, it } from "vitest";

import { prisma } from "~backend/lib/prisma";
import { verifyPassword } from "~backend/lib/password";
import { ensureUser } from "~backend/modules/users/bootstrap";

describe("ensureUser (seed and first-admin bootstrap)", () => {
  it("creates a user once and never overwrites an existing password", async () => {
    const seed = {
      email: "Admin@Test.local",
      displayName: "Administrator",
      password: "first-password-long",
      role: "admin",
    } as const;

    expect(await ensureUser(seed)).toBe("created");
    expect(await ensureUser({ ...seed, password: "second-password-long" })).toBe("exists");

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "admin@test.local" },
      include: { role: true },
    });
    expect(user.role.key).toBe("admin");
    expect(await verifyPassword("first-password-long", user.passwordHash)).toBe(true);
  });
});
