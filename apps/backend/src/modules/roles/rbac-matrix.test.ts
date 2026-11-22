import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLE_PERMISSIONS,
  type Permission,
} from "@subsurf/contracts/auth/permissions";
import { ErrorResponseSchema } from "@subsurf/contracts/common/common.schema";

import { prisma } from "~backend/lib/prisma";
import { serviceWithMatch } from "~backend/modules/vulnerabilities/test/matches";
import { createUser, signInAs } from "~backend/test/auth";
import { startTestServer, type TestServer } from "~backend/test/http";
import { HOURLY_UTC, addTargets, createPipeline, pipelineBody } from "~backend/test/pipelines";

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
const mappingPath = async () => {
  const mapping = await prisma.packageMapping.create({
    data: {
      cpeVendor: "vendor",
      cpeProduct: `product-${Math.random()}`,
      ecosystem: "Maven",
      packageName: "org.example:example",
    },
  });
  return `/v1/vulnerabilities/mappings/${mapping.id}`;
};
const triagePath = async () => {
  const { serviceId, canonicalId } = await serviceWithMatch();
  return `/v1/vulnerabilities/services/${serviceId}/${canonicalId}`;
};
const customRolePath = async () =>
  `/v1/roles/${(await prisma.role.create({ data: { name: `Custom ${Math.random()}`, permissions: [] } })).id}`;

const pipelinePath = async (suffix = "") => `/v1/pipelines/${await createPipeline()}${suffix}`;
const runnablePipelinePath = async () => {
  await addTargets([`10.${Math.floor(Math.random() * 200)}.0.0/24`]);
  return pipelinePath("/runs");
};
const queuedScanPath = async (suffix: string) => {
  const { id } = await prisma.scan.create({
    data: {
      ports: "22",
      maxRate: 100,
      batchSize: 256,
      targetCount: 0,
      addressCount: 0,
      jobCount: 0,
      requestedById: (await createUser()).id,
    },
  });
  return `/v1/scans/${id}${suffix}`;
};
const workerPath = async (name: string) =>
  `/v1/workers/${(await prisma.worker.findUniqueOrThrow({ where: { name } })).id}`;
const customWorkerPath = async () => {
  const { id } = await prisma.worker.create({
    data: { name: `custom-${Math.floor(Math.random() * 1e9)}`, displayName: "Custom" },
  });
  return `/v1/workers/${id}`;
};

// Every protected endpoint, with a request that succeeds for an authorized caller.
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
  {
    permission: "targets:create",
    method: "POST",
    path: async () => "/v1/targets/import",
    body: async () => ({ entries: [{ value: "192.0.2.10" }], startScan: false }),
  },
  {
    permission: "vulnerabilities:read",
    method: "GET",
    path: async () => "/v1/vulnerabilities/sources",
  },
  {
    permission: "vulnerabilities:read",
    method: "GET",
    path: async () => "/v1/vulnerabilities/sources/nvd/runs",
  },
  {
    permission: "vulnerabilities:run",
    method: "POST",
    path: async () => "/v1/vulnerabilities/sources/nvd/sync",
    body: async () => ({ mode: "incremental" }),
  },
  {
    permission: "vulnerabilities:run",
    method: "PATCH",
    path: async () => "/v1/vulnerabilities/sources/osv",
    body: async () => ({ enabled: true }),
  },
  {
    permission: "vulnerabilities:read",
    method: "GET",
    path: async () => "/v1/vulnerabilities/mappings",
  },
  {
    permission: "vulnerabilities:create",
    method: "POST",
    path: async () => "/v1/vulnerabilities/mappings",
    body: async () => ({
      cpeVendor: "acme",
      cpeProduct: `widget-${Math.floor(Math.random() * 1e9)}`,
      ecosystem: "npm",
      packageName: "widget",
    }),
  },
  { permission: "vulnerabilities:delete", method: "DELETE", path: mappingPath },
  {
    permission: "vulnerabilities:update",
    method: "PATCH",
    path: triagePath,
    body: async () => ({ triage: "important" }),
  },
  { permission: "pipelines:read", method: "GET", path: async () => "/v1/pipelines" },
  { permission: "pipelines:read", method: "GET", path: () => pipelinePath() },
  {
    permission: "pipelines:read",
    method: "POST",
    path: async () => "/v1/pipelines/schedule/preview",
    body: async () => ({ schedule: HOURLY_UTC }),
  },
  {
    permission: "pipelines:create",
    method: "POST",
    path: async () => "/v1/pipelines",
    body: () => pipelineBody(),
  },
  {
    permission: "pipelines:update",
    method: "PATCH",
    path: () => pipelinePath(),
    body: async () => ({ description: "Changed" }),
  },
  { permission: "pipelines:delete", method: "DELETE", path: () => pipelinePath() },
  { permission: "scans:run", method: "POST", path: runnablePipelinePath },
  { permission: "scans:read", method: "GET", path: () => queuedScanPath("/jobs") },
  { permission: "scans:run", method: "POST", path: () => queuedScanPath("/stop") },
  { permission: "workers:read", method: "GET", path: async () => "/v1/workers" },
  {
    permission: "workers:update",
    method: "PATCH",
    path: () => workerPath("masscan"),
    body: async () => ({ maxRate: 5000 }),
  },
  { permission: "workers:delete", method: "DELETE", path: customWorkerPath },
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
