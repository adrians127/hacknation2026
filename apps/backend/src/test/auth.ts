import { randomUUID } from "node:crypto";

import type { SystemRoleKey } from "@hacknation/contracts/auth/permissions";

import { hashPassword } from "~backend/lib/password";
import { prisma } from "~backend/lib/prisma";
import { TestClient, type TestServer } from "~backend/test/http";

export const TEST_PASSWORD = "correct-horse-battery-staple";

// One hash for every test user: argon2 is deliberately slow.
let testPasswordHash: Promise<string> | undefined;

export interface CreateUserOptions {
  role?: SystemRoleKey;
  roleId?: string;
  email?: string;
  mustChangePassword?: boolean;
  isActive?: boolean;
}

export async function createUser(options: CreateUserOptions = {}) {
  const roleId =
    options.roleId ??
    (await prisma.role.findUniqueOrThrow({ where: { key: options.role ?? "viewer" } })).id;
  testPasswordHash ??= hashPassword(TEST_PASSWORD);

  return prisma.user.create({
    data: {
      email: options.email ?? `user-${randomUUID()}@test.local`,
      displayName: "Test User",
      passwordHash: await testPasswordHash,
      roleId,
      mustChangePassword: options.mustChangePassword ?? false,
      isActive: options.isActive ?? true,
    },
    include: { role: true },
  });
}

export async function signIn(
  server: TestServer,
  email: string,
  password = TEST_PASSWORD,
): Promise<TestClient> {
  const client = new TestClient(server.baseUrl);
  const res = await client.post("/v1/auth/login", { body: { email, password } });
  if (res.status !== 200) throw new Error(`Sign-in as ${email} failed with ${res.status}`);
  return client;
}

/** A new user with the given system role (or custom role id), already signed in. */
export async function signInAs(server: TestServer, options: CreateUserOptions) {
  const user = await createUser(options);
  return { user, client: await signIn(server, user.email) };
}
