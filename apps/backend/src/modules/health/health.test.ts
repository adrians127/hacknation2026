import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { HealthResponseSchema } from "@subsurf/contracts/health/health.schema";

import { prisma } from "~backend/lib/prisma";
import { startTestServer, type TestServer } from "~backend/test/http";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

describe("GET /v1/health", () => {
  it("answers with the contract shape and reports the database as up", async () => {
    const res = await fetch(`${server.baseUrl}/v1/health`);

    expect(res.status).toBe(200);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ status: "ok", database: "up" });
  });

  it("reports degraded when the database probe fails", async () => {
    const probe = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("down"));

    const res = await fetch(`${server.baseUrl}/v1/health`);

    expect(HealthResponseSchema.parse(await res.json())).toMatchObject({
      status: "degraded",
      database: "down",
    });
    probe.mockRestore();
  });

  it("returns the JSON error envelope for unknown routes", async () => {
    const res = await fetch(`${server.baseUrl}/v1/nope`);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { status: 404 } });
  });
});
