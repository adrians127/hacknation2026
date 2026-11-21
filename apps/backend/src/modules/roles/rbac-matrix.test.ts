import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLE_PERMISSIONS,
  type Permission,
} from "@hacknation/contracts/auth/permissions";
import { ErrorResponseSchema } from "@hacknation/contracts/common/common.schema";

import { prisma } from "~backend/lib/prisma";
import { createUser, signInAs } from "~backend/test/auth";
import { startTestServer, type TestServer } from "~backend/test/http";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

interface Endpoint {
  permission: Permission;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: () => Promise<string>;
  body?: () => Promise<unknown>;
}

const viewerRoleId = async () =>
  (await prisma.role.findUniqueOrThrow({ where: { key: "viewer" } })).id;
const someUserPath = async (suffix = "") => `/v1/users/${(await createUser()).id}${suffix}`;
const customRolePath = async () =>
  `/v1/roles/${(await prisma.role.create({ data: { name: `Custom ${Math.random()}`, permissions: [] } })).id}`;

// Every protected users/roles endpoint, with a request that succeeds for an authorized caller.
const ENDPOINTS: Endpoint[] = [
  { permission: "users:read", method: "GET", path: async () => "/v1/users" },
  { permission: "users:read", method: "GET", path: () => someUserPath() },
  {
    permission: "users:create",
    method: "POST",
    path: async () => "/v1/users",
    body: async () => ({
      email: `new-${Math.random()}@test.local`,
      displayName: "New",
      roleId: await viewerRoleId(),
    }),
  },
  {
    permission: "users:update",
    method: "PATCH",
    path: () => someUserPath(),
    body: async () => ({ displayName: "Renamed" }),
  },
  { permission: "users:update", method: "POST", path: () => someUserPath("/reset-password") },
  { permission: "users:delete", method: "POST", path: () => someUserPath("/deactivate") },
  { permission: "users:delete", method: "POST", path: () => someUserPath("/reactivate") },
  { permission: "roles:read", method: "GET", path: async () => "/v1/roles" },
  { permission: "roles:read", method: "GET", path: customRolePath },
  {
    permission: "roles:create",
    method: "POST",
    path: async () => "/v1/roles",
    body: async () => ({ name: `Role ${Math.random()}`, description: "", permissions: [] }),
  },
  {
    permission: "roles:update",
    method: "PATCH",
    path: customRolePath,
    body: async () => ({ description: "Changed" }),
  },
  { permission: "roles:delete", method: "DELETE", path: customRolePath },
];

describe.each(SYSTEM_ROLE_KEYS)("system role %s", (roleKey) => {
  const granted = new Set<Permission>(SYSTEM_ROLE_PERMISSIONS[roleKey]);

  it.each(ENDPOINTS.map((endpoint) => [`${endpoint.method} ${endpoint.permission}`, endpoint] as const))(
    "%s",
    async (_name, endpoint) => {
      const { client } = await signInAs(server, { role: roleKey });
      const path = await endpoint.path();
      const body = endpoint.body ? await endpoint.body() : undefined;

      const res = await client.request(endpoint.method, path, { body });

      const outcome =
        res.status < 300
          ? "allowed"
          : `${res.status} ${ErrorResponseSchema.parse(await res.json()).error.code}`;
      expect(outcome).toBe(granted.has(endpoint.permission) ? "allowed" : "403 FORBIDDEN");
    },
  );
});

it("refuses every protected endpoint without a session", async () => {
  for (const endpoint of ENDPOINTS) {
    const res = await fetch(`${server.baseUrl}${await endpoint.path()}`, {
      method: endpoint.method,
    });
    expect(res.status, `${endpoint.method} ${endpoint.permission}`).toBe(401);
  }
});
