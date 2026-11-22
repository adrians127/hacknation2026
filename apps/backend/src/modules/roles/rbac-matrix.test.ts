import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLE_PERMISSIONS,
  type Permission,
} from "@subsurf/contracts/auth/permissions";
import { ErrorResponseSchema } from "@subsurf/contracts/common/common.schema";
import { buildWorkerResult } from "@subsurf/contracts/workers/worker-result.fixture";

import { buildApiDocs } from "~backend/lib/api-docs";
import { prisma } from "~backend/lib/prisma";
import { serviceWithMatch } from "~backend/modules/vulnerabilities/test/matches";
import { createUser, signInAs } from "~backend/test/auth";
import { startTestServer, type TestServer } from "~backend/test/http";
import { HOURLY_UTC, addTargets, createPipeline, pipelineBody } from "~backend/test/pipelines";
import { hostIdOf, ingestScan } from "~backend/test/scans";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

// The test DefectDojo has no products, so a permitted sync succeeds without a real instance.
beforeEach(() => {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host !== "defectdojo.test") return realFetch(input, init);
    return Response.json({ count: 0, next: null, previous: null, results: [] });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Endpoint {
  /** Method and path as openapi.json spells them: the coverage test matches on it. */
  route: string;
  /** The caller needs every one of them. */
  requires: readonly Permission[];
  path: () => Promise<string>;
  body?: () => Promise<unknown>;
  /** What a permitted caller gets when the request cannot succeed in a test; a 2xx otherwise. */
  permitted?: string;
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
const scanPath = async (suffix = "") => `/v1/scans/${await ingestScan()}${suffix}`;
const scanHostPath = async () => {
  const path = await scanPath("/hosts");
  return `${path}/${await hostIdOf("10.0.5.7")}`;
};
const hostPath = async () => `/v1/hosts/${(await serviceWithMatch()).hostId}`;
const servicePath = async () => {
  const { hostId, serviceId } = await serviceWithMatch();
  return `/v1/hosts/${hostId}/services/${serviceId}`;
};
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
const scanReportPath = (kind: string) => async () => `/v1/reports/scans/${await ingestScan()}/${kind}`;
const importTargets = (startScan: boolean) => async () => ({
  entries: [{ value: "192.0.2.10" }],
  startScan,
});

// Every protected endpoint, with a request that succeeds for an authorized caller.
// A new endpoint adds its row to its module's group; the coverage test below fails until it does.
const ENDPOINTS: Endpoint[] = [
  // users
  { route: "GET /users", requires: ["users:read"], path: async () => "/v1/users" },
  { route: "GET /users/{id}", requires: ["users:read"], path: () => someUserPath() },
  {
    route: "POST /users",
    requires: ["users:create"],
    path: async () => "/v1/users",
    body: async () => ({
      email: `new-${Math.random()}@test.local`,
      displayName: "New",
      roleId: await viewerRoleId(),
    }),
  },
  {
    route: "PATCH /users/{id}",
    requires: ["users:update"],
    path: () => someUserPath(),
    body: async () => ({ displayName: "Renamed" }),
  },
  {
    route: "POST /users/{id}/reset-password",
    requires: ["users:update"],
    path: () => someUserPath("/reset-password"),
  },
  {
    route: "POST /users/{id}/deactivate",
    requires: ["users:delete"],
    path: () => someUserPath("/deactivate"),
  },
  {
    route: "POST /users/{id}/reactivate",
    requires: ["users:delete"],
    path: () => someUserPath("/reactivate"),
  },

  // roles
  { route: "GET /roles", requires: ["roles:read"], path: async () => "/v1/roles" },
  { route: "GET /roles/{id}", requires: ["roles:read"], path: customRolePath },
  {
    route: "POST /roles",
    requires: ["roles:create"],
    path: async () => "/v1/roles",
    body: async () => ({ name: `Role ${Math.random()}`, description: "", permissions: [] }),
  },
  {
    route: "PATCH /roles/{id}",
    requires: ["roles:update"],
    path: customRolePath,
    body: async () => ({ description: "Changed" }),
  },
  { route: "DELETE /roles/{id}", requires: ["roles:delete"], path: customRolePath },

  // targets
  {
    route: "POST /targets/import",
    requires: ["targets:create"],
    path: async () => "/v1/targets/import",
    body: importTargets(false),
  },
  {
    route: "POST /targets/import",
    requires: ["targets:create", "scans:run"],
    path: async () => "/v1/targets/import",
    body: importTargets(true),
  },

  // scans
  { route: "GET /scans", requires: ["scans:read"], path: async () => "/v1/scans" },
  {
    route: "POST /scans/import",
    requires: ["scans:read", "scans:create"],
    path: async () => "/v1/scans/import",
    body: async () =>
      buildWorkerResult({ scanId: randomUUID(), jobId: randomUUID(), leaseId: randomUUID() }),
  },
  { route: "GET /scans/{id}", requires: ["scans:read"], path: () => scanPath() },
  {
    route: "PATCH /scans/{id}",
    requires: ["scans:read", "scans:update"],
    path: () => scanPath(),
    body: async () => ({ name: "Renamed" }),
  },
  { route: "DELETE /scans/{id}", requires: ["scans:read", "scans:delete"], path: () => scanPath() },
  { route: "GET /scans/{id}/hosts", requires: ["scans:read"], path: () => scanPath("/hosts") },
  { route: "GET /scans/{id}/hosts/{hostId}", requires: ["scans:read"], path: scanHostPath },
  { route: "GET /scans/{id}/changes", requires: ["scans:read"], path: () => scanPath("/changes") },
  { route: "GET /scans/{id}/export", requires: ["scans:read"], path: () => scanPath("/export") },
  {
    route: "POST /scans/{id}/hosts/tags",
    requires: ["scans:read", "hosts:update"],
    path: () => scanPath("/hosts/tags"),
    body: async () => ({ action: "add", tag: "dmz", selectors: ["10.0.5.0/24"] }),
  },

  { route: "GET /scans/{id}/jobs", requires: ["scans:read"], path: () => queuedScanPath("/jobs") },
  {
    route: "POST /scans/{id}/stop",
    requires: ["scans:read", "scans:run"],
    path: () => queuedScanPath("/stop"),
  },

  // pipelines
  { route: "GET /pipelines", requires: ["pipelines:read"], path: async () => "/v1/pipelines" },
  { route: "GET /pipelines/{id}", requires: ["pipelines:read"], path: () => pipelinePath() },
  {
    route: "POST /pipelines/schedule/preview",
    requires: ["pipelines:read"],
    path: async () => "/v1/pipelines/schedule/preview",
    body: async () => ({ schedule: HOURLY_UTC }),
  },
  {
    route: "POST /pipelines",
    requires: ["pipelines:create"],
    path: async () => "/v1/pipelines",
    body: () => pipelineBody(),
  },
  {
    route: "PATCH /pipelines/{id}",
    requires: ["pipelines:update"],
    path: () => pipelinePath(),
    body: async () => ({ description: "Changed" }),
  },
  { route: "DELETE /pipelines/{id}", requires: ["pipelines:delete"], path: () => pipelinePath() },
  { route: "POST /pipelines/{id}/runs", requires: ["scans:run"], path: runnablePipelinePath },

  // workers
  { route: "GET /workers", requires: ["workers:read"], path: async () => "/v1/workers" },
  {
    route: "PATCH /workers/{id}",
    requires: ["workers:update"],
    path: () => workerPath("masscan"),
    body: async () => ({ maxRate: 5000 }),
  },
  { route: "DELETE /workers/{id}", requires: ["workers:delete"], path: customWorkerPath },

  // reports
  { route: "GET /reports/scans/{id}/summary", requires: ["scans:read"], path: scanReportPath("summary") },
  { route: "GET /reports/scans/{id}/findings", requires: ["scans:read"], path: scanReportPath("findings") },
  {
    route: "GET /reports/scans/{id}/technologies",
    requires: ["scans:read"],
    path: scanReportPath("technologies"),
  },
  { route: "GET /reports/scans/{id}/exposure", requires: ["scans:read"], path: scanReportPath("exposure") },
  { route: "GET /reports/scans/{id}/triage", requires: ["scans:read"], path: scanReportPath("triage") },
  { route: "GET /reports/scans/{id}/tags", requires: ["scans:read"], path: scanReportPath("tags") },
  {
    route: "GET /reports/diff",
    requires: ["scans:read"],
    path: async () => `/v1/reports/diff?from=${await ingestScan()}&to=${await ingestScan()}`,
  },
  {
    route: "GET /reports/ips/{ip}",
    requires: ["scans:read"],
    path: async () => {
      await ingestScan();
      return "/v1/reports/ips/10.0.5.7";
    },
  },
  {
    route: "GET /reports/stability",
    requires: ["scans:read"],
    path: async () => `/v1/reports/stability?scanId=${await ingestScan()}`,
  },
  {
    route: "GET /reports/time-of-day",
    requires: ["scans:read"],
    path: async () => {
      await ingestScan();
      return "/v1/reports/time-of-day";
    },
  },

  // hosts
  {
    route: "PATCH /hosts/{id}",
    requires: ["hosts:update"],
    path: hostPath,
    body: async () => ({ triage: "reviewed" }),
  },
  {
    route: "PATCH /hosts/{id}/services/{serviceId}",
    requires: ["hosts:update"],
    path: servicePath,
    body: async () => ({ triage: "reviewed" }),
  },

  // dashboard
  { route: "GET /dashboard", requires: ["scans:read"], path: async () => "/v1/dashboard" },

  // vulnerabilities
  {
    route: "GET /vulnerabilities/sources",
    requires: ["vulnerabilities:read"],
    path: async () => "/v1/vulnerabilities/sources",
  },
  {
    route: "GET /vulnerabilities/sources/{id}/runs",
    requires: ["vulnerabilities:read"],
    path: async () => "/v1/vulnerabilities/sources/nvd/runs",
  },
  {
    route: "POST /vulnerabilities/sources/{id}/sync",
    requires: ["vulnerabilities:run"],
    path: async () => "/v1/vulnerabilities/sources/nvd/sync",
    body: async () => ({ mode: "incremental" }),
  },
  {
    route: "PATCH /vulnerabilities/sources/{id}",
    requires: ["vulnerabilities:run"],
    path: async () => "/v1/vulnerabilities/sources/osv",
    body: async () => ({ enabled: true }),
  },
  {
    route: "GET /vulnerabilities/mappings",
    requires: ["vulnerabilities:read"],
    path: async () => "/v1/vulnerabilities/mappings",
  },
  {
    route: "POST /vulnerabilities/mappings",
    requires: ["vulnerabilities:create"],
    path: async () => "/v1/vulnerabilities/mappings",
    body: async () => ({
      cpeVendor: "acme",
      cpeProduct: `widget-${Math.floor(Math.random() * 1e9)}`,
      ecosystem: "npm",
      packageName: "widget",
    }),
  },
  {
    route: "DELETE /vulnerabilities/mappings/{id}",
    requires: ["vulnerabilities:delete"],
    path: mappingPath,
  },
  {
    route: "PATCH /vulnerabilities/services/{serviceId}/{canonicalId}",
    requires: ["vulnerabilities:update"],
    path: triagePath,
    body: async () => ({ triage: "important" }),
  },

  // defectdojo
  {
    route: "GET /defectdojo/sync",
    requires: ["defectdojo:read"],
    path: async () => "/v1/defectdojo/sync",
  },
  {
    route: "POST /defectdojo/sync",
    requires: ["defectdojo:import"],
    path: async () => "/v1/defectdojo/sync",
  },
  {
    route: "POST /defectdojo/push",
    requires: ["defectdojo:export"],
    path: async () => "/v1/defectdojo/push",
    // A scan without open services is refused before DefectDojo is contacted.
    body: async () => ({
      scanId: await ingestScan((hosts) => hosts.filter((host) => host.status !== "up")),
    }),
    permitted: "400 NOTHING_TO_PUSH",
  },
];

const methodOf = (endpoint: Endpoint) => endpoint.route.slice(0, endpoint.route.indexOf(" "));

/** The route's path template as a pattern for the request path, query string aside. */
function routePattern(endpoint: Endpoint): RegExp {
  const template = endpoint.route.slice(endpoint.route.indexOf(" ") + 1);
  return new RegExp(`^/v1${template.replaceAll(/\{[^}]+\}/g, "[^/]+")}$`);
}

describe.each(SYSTEM_ROLE_KEYS)("system role %s", (roleKey) => {
  const granted = new Set<Permission>(SYSTEM_ROLE_PERMISSIONS[roleKey]);

  it.each(
    ENDPOINTS.map((endpoint) => [`${endpoint.route} (${endpoint.requires.join(" + ")})`, endpoint] as const),
  )("%s", async (_name, endpoint) => {
    const { client } = await signInAs(server, { role: roleKey });
    const path = await endpoint.path();
    const body = endpoint.body ? await endpoint.body() : undefined;
    expect(path.split("?")[0]).toMatch(routePattern(endpoint));

    const res = await client.request(methodOf(endpoint), path, { body });

    const outcome =
      res.status < 300
        ? "allowed"
        : `${res.status} ${ErrorResponseSchema.parse(await res.json()).error.code}`;
    const permitted = endpoint.requires.every((permission) => granted.has(permission));
    expect(outcome).toBe(permitted ? (endpoint.permitted ?? "allowed") : "403 FORBIDDEN");
  });
});

it("refuses every protected endpoint without a session", async () => {
  for (const endpoint of ENDPOINTS) {
    const res = await fetch(`${server.baseUrl}${await endpoint.path()}`, {
      method: methodOf(endpoint),
    });
    expect(res.status, `${endpoint.route} without a session`).toBe(401);
  }
});

const ContractSchema = z.object({
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
});
const OperationSchema = z.object({
  security: z.array(z.record(z.string(), z.unknown())),
});

function needsSession(operation: unknown): boolean {
  const parsed = OperationSchema.safeParse(operation);
  return parsed.success && parsed.data.security.some((scheme) => "cookieAuth" in scheme);
}

// Any signed-in user may call these, whatever the role.
const SESSION_ONLY = new Set(["GET /auth/me", "POST /auth/change-password"]);

it("has a row for every operation the contract protects with a session", () => {
  const { paths } = ContractSchema.parse(buildApiDocs());
  const contractRoutes = Object.entries(paths)
    .flatMap(([path, operations]) =>
      Object.entries(operations)
        .filter(([, operation]) => needsSession(operation))
        .map(([method]) => `${method.toUpperCase()} ${path}`),
    )
    .filter((route) => !SESSION_ONLY.has(route));
  const rows = new Set(ENDPOINTS.map((endpoint) => endpoint.route));

  expect(contractRoutes.filter((route) => !rows.has(route))).toEqual([]);
  expect([...rows].filter((route) => !contractRoutes.includes(route))).toEqual([]);
});
