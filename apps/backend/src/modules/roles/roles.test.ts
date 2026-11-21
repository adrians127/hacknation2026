import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PERMISSIONS } from "@subsurf/contracts/auth/permissions";
import {
  RoleDetailResponseSchema,
  RoleListResponseSchema,
  RoleSchema,
} from "@subsurf/contracts/roles/roles.schema";

import { prisma } from "~backend/lib/prisma";
import { syncSystemRoles } from "~backend/modules/roles/system-roles";
import { createUser, signInAs } from "~backend/test/auth";
import { startTestServer, type TestServer } from "~backend/test/http";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

const systemRole = (key: string) => prisma.role.findUniqueOrThrow({ where: { key } });

describe("system roles", () => {
  it("lists the four roles from the task first, admin holding every permission", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    await prisma.role.create({ data: { name: "Auditor", permissions: ["users:read"] } });

    const res = await client.get("/v1/roles");

    expect(res.status).toBe(200);
    const { items } = RoleListResponseSchema.parse(await res.json());
    expect(items.map((role) => role.key)).toEqual(["admin", "editor", "analyst", "viewer", null]);
    expect(items[0]).toMatchObject({ isSystem: true, permissions: [...PERMISSIONS], userCount: 1 });
  });

  it("are read-only", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    const viewer = await systemRole("viewer");

    const update = await client.patch(`/v1/roles/${viewer.id}`, {
      body: { permissions: ["users:read"] },
    });
    const remove = await client.delete(`/v1/roles/${viewer.id}`);

    expect(update.status).toBe(403);
    expect(await update.json()).toMatchObject({ error: { code: "SYSTEM_ROLE_READ_ONLY" } });
    expect(remove.status).toBe(403);
  });

  it("sync restores system permissions and drops unknown ones from custom roles", async () => {
    const admin = await systemRole("admin");
    await prisma.role.update({ where: { id: admin.id }, data: { permissions: [] } });
    const custom = await prisma.role.create({
      data: { name: "Legacy", permissions: ["users:read", "scans:teleport"] },
    });

    await syncSystemRoles();

    expect((await systemRole("admin")).permissions).toEqual([...PERMISSIONS]);
    expect((await prisma.role.findUniqueOrThrow({ where: { id: custom.id } })).permissions).toEqual(
      ["users:read"],
    );
  });
});

describe("custom roles", () => {
  it("can be created, and grant exactly what was ticked", async () => {
    const { client } = await signInAs(server, { role: "admin" });

    const res = await client.post("/v1/roles", {
      body: {
        name: "Auditor",
        description: "Reads accounts",
        permissions: ["users:read", "users:read"],
      },
    });

    expect(res.status).toBe(201);
    const role = RoleSchema.parse(await res.json());
    expect(role).toMatchObject({ key: null, isSystem: false, permissions: ["users:read"] });

    const { client: auditor } = await signInAs(server, { roleId: role.id });
    expect((await auditor.get("/v1/users")).status).toBe(200);
    expect((await auditor.get("/v1/roles")).status).toBe(403);
    const create = await auditor.post("/v1/users", {
      body: { email: "x@test.local", displayName: "X", roleId: role.id },
    });
    expect(create.status).toBe(403);
  });

  it("apply permission changes to their users immediately", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    const role = await prisma.role.create({ data: { name: "Auditor", permissions: ["users:read"] } });
    const { client: auditor } = await signInAs(server, { roleId: role.id });
    expect((await auditor.get("/v1/users")).status).toBe(200);

    const res = await client.patch(`/v1/roles/${role.id}`, { body: { permissions: [] } });

    expect(res.status).toBe(200);
    expect((await auditor.get("/v1/users")).status).toBe(403);
  });

  it("show their users", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    const role = await prisma.role.create({ data: { name: "Auditor", permissions: [] } });
    const member = await createUser({ roleId: role.id });

    const res = await client.get(`/v1/roles/${role.id}`);

    expect(res.status).toBe(200);
    const detail = RoleDetailResponseSchema.parse(await res.json());
    expect(detail.userCount).toBe(1);
    expect(detail.users).toEqual([
      { id: member.id, email: member.email, displayName: member.displayName, isActive: true },
    ]);
  });

  it("need a unique name", async () => {
    const { client } = await signInAs(server, { role: "admin" });

    const res = await client.post("/v1/roles", {
      body: { name: "Admin", description: "", permissions: [] },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "ROLE_NAME_TAKEN" } });
  });

  it("cannot be deleted while in use, unless the users are moved in the same step", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    const role = await prisma.role.create({ data: { name: "Temp", permissions: [] } });
    const member = await createUser({ roleId: role.id });
    const viewer = await systemRole("viewer");

    const refused = await client.delete(`/v1/roles/${role.id}`);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "ROLE_IN_USE" } });

    const moved = await client.delete(`/v1/roles/${role.id}?reassignToRoleId=${viewer.id}`);
    expect(moved.status).toBe(204);
    expect(await prisma.role.findUnique({ where: { id: role.id } })).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).roleId).toBe(
      viewer.id,
    );
  });

  it("cannot grant permissions the editor of the role does not hold", async () => {
    const roleManager = await prisma.role.create({
      data: { name: "Role manager", permissions: ["roles:read", "roles:create", "roles:update"] },
    });
    const { client } = await signInAs(server, { roleId: roleManager.id });

    const escalate = await client.post("/v1/roles", {
      body: { name: "Shadow admin", description: "", permissions: ["users:delete"] },
    });
    const ownRole = await client.patch(`/v1/roles/${roleManager.id}`, {
      body: { permissions: ["roles:read", "roles:create", "roles:update", "roles:delete"] },
    });

    expect(escalate.status).toBe(403);
    expect(await escalate.json()).toMatchObject({ error: { code: "PERMISSION_ESCALATION" } });
    expect(ownRole.status).toBe(403);
    expect(await ownRole.json()).toMatchObject({ error: { code: "SELF_MODIFICATION" } });
  });
});
