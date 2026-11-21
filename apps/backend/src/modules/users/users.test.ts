import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MeResponseSchema } from "@hacknation/contracts/auth/auth.schema";
import { SYSTEM_ROLE_PERMISSIONS } from "@hacknation/contracts/auth/permissions";
import {
  UserListResponseSchema,
  UserSchema,
  UserWithTemporaryPasswordResponseSchema,
} from "@hacknation/contracts/users/users.schema";

import { prisma } from "~backend/lib/prisma";
import { createUser, signIn, signInAs, TEST_PASSWORD } from "~backend/test/auth";
import { startTestServer, type TestServer } from "~backend/test/http";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

const roleId = async (key: string) =>
  (await prisma.role.findUniqueOrThrow({ where: { key } })).id;

describe("users (as admin)", () => {
  it("creates a user with a one-time temporary password that must be changed", async () => {
    const { client } = await signInAs(server, { role: "admin" });

    const res = await client.post("/v1/users", {
      body: { email: "New.Analyst@test.local", displayName: "New Analyst", roleId: await roleId("analyst") },
    });

    expect(res.status).toBe(201);
    const { user, temporaryPassword } = UserWithTemporaryPasswordResponseSchema.parse(
      await res.json(),
    );
    expect(user).toMatchObject({
      email: "new.analyst@test.local",
      role: { key: "analyst" },
      mustChangePassword: true,
    });

    const newcomer = await signIn(server, user.email, temporaryPassword);
    const me = MeResponseSchema.parse(await (await newcomer.get("/v1/auth/me")).json());
    expect(me.mustChangePassword).toBe(true);
    // Until the password is changed, everything but /auth/me and change-password is refused.
    const blocked = await newcomer.get("/v1/users");
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: { code: "PASSWORD_CHANGE_REQUIRED" } });
  });

  it("refuses a duplicate email", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    const existing = await createUser();

    const res = await client.post("/v1/users", {
      body: { email: existing.email.toUpperCase(), displayName: "Copy", roleId: existing.roleId },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "EMAIL_TAKEN" } });
  });

  it("lists users without password hashes", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    await createUser({ role: "viewer" });

    const res = await client.get("/v1/users");
    const raw = await res.text();

    expect(res.status).toBe(200);
    expect(UserListResponseSchema.parse(JSON.parse(raw)).items).toHaveLength(2);
    expect(raw).not.toContain("argon2");
  });

  it("changes a role, and the change applies to the user's very next request", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    const { user, client: target } = await signInAs(server, { role: "viewer" });
    expect((await target.get("/v1/users")).status).toBe(403);

    const res = await client.patch(`/v1/users/${user.id}`, {
      body: { roleId: await roleId("admin") },
    });

    expect(res.status).toBe(200);
    expect(UserSchema.parse(await res.json()).role.key).toBe("admin");
    expect((await target.get("/v1/users")).status).toBe(200);
  });

  it("resets a password: old one stops working, sessions end, the lockout clears", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    const { user, client: target } = await signInAs(server, { role: "viewer" });
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() + 60_000) },
    });

    const res = await client.post(`/v1/users/${user.id}/reset-password`);

    expect(res.status).toBe(200);
    const { temporaryPassword } = UserWithTemporaryPasswordResponseSchema.parse(await res.json());
    expect((await target.get("/v1/auth/me")).status).toBe(401);
    await expect(signIn(server, user.email, TEST_PASSWORD)).rejects.toThrow(/failed with 401/);
    await expect(signIn(server, user.email, temporaryPassword)).resolves.toBeDefined();
  });

  it("deactivates (never deletes) and reactivates", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    const { user, client: target } = await signInAs(server, { role: "viewer" });

    const deactivated = await client.post(`/v1/users/${user.id}/deactivate`);
    expect(deactivated.status).toBe(200);
    expect(UserSchema.parse(await deactivated.json()).isActive).toBe(false);
    expect((await target.get("/v1/auth/me")).status).toBe(401);
    await expect(signIn(server, user.email)).rejects.toThrow(/failed with 401/);

    expect((await client.post(`/v1/users/${user.id}/reactivate`)).status).toBe(200);
    await expect(signIn(server, user.email)).resolves.toBeDefined();
  });

  it("returns 404 for an unknown user and 400 for a malformed id", async () => {
    const { client } = await signInAs(server, { role: "admin" });

    expect((await client.get("/v1/users/0195f3c4-0000-7000-8000-000000000000")).status).toBe(404);
    expect((await client.get("/v1/users/not-a-uuid")).status).toBe(400);
  });
});

describe("users: guard rails", () => {
  it("does not let anyone change their own role or deactivate themselves", async () => {
    const { user, client } = await signInAs(server, { role: "admin" });

    const ownRole = await client.patch(`/v1/users/${user.id}`, {
      body: { roleId: await roleId("viewer") },
    });
    const ownAccount = await client.post(`/v1/users/${user.id}/deactivate`);

    expect(ownRole.status).toBe(403);
    expect(await ownRole.json()).toMatchObject({ error: { code: "SELF_MODIFICATION" } });
    expect(ownAccount.status).toBe(403);
  });

  it("keeps at least one active admin", async () => {
    const lastAdmin = await createUser({ role: "admin" });
    // Everything an admin has, but not the admin role: may manage the admin, yet not remove the last one.
    const superRole = await prisma.role.create({
      data: { name: "Superuser", permissions: [...(await prisma.role.findUniqueOrThrow({ where: { key: "admin" } })).permissions] },
    });
    const { client } = await signInAs(server, { roleId: superRole.id });

    const demote = await client.patch(`/v1/users/${lastAdmin.id}`, {
      body: { roleId: await roleId("viewer") },
    });
    const deactivate = await client.post(`/v1/users/${lastAdmin.id}/deactivate`);

    expect(demote.status).toBe(409);
    expect(await demote.json()).toMatchObject({ error: { code: "LAST_ADMIN" } });
    expect(deactivate.status).toBe(409);
  });

  it("does not let a user manager hand out or touch permissions they lack", async () => {
    // Holds the viewer's permissions too, so handing out the viewer role is allowed.
    const manager = await prisma.role.create({
      data: {
        name: "User manager",
        permissions: ["users:read", "users:create", "users:update", ...SYSTEM_ROLE_PERMISSIONS.viewer],
      },
    });
    const { client } = await signInAs(server, { roleId: manager.id });
    const admin = await createUser({ role: "admin" });

    const createAdmin = await client.post("/v1/users", {
      body: { email: "sneaky@test.local", displayName: "Sneaky", roleId: await roleId("admin") },
    });
    const resetAdmin = await client.post(`/v1/users/${admin.id}/reset-password`);
    const createViewer = await client.post("/v1/users", {
      body: { email: "viewer@test.local", displayName: "Viewer", roleId: await roleId("viewer") },
    });

    expect(createAdmin.status).toBe(403);
    expect(await createAdmin.json()).toMatchObject({ error: { code: "PERMISSION_ESCALATION" } });
    expect(resetAdmin.status).toBe(403);
    expect(createViewer.status).toBe(201);
  });
});
