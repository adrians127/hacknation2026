import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HealthResponseSchema } from "@hacknation/contracts/health/health.schema";

import { buildApp } from "~backend/app";
import { prisma } from "~backend/lib/prisma";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = buildApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

describe("GET /v1/health", () => {
  it("answers with the contract shape and reports the database as down when unreachable", async () => {
    const res = await fetch(`${baseUrl}/v1/health`);

    expect(res.status).toBe(200);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body.database).toBe("down");
    expect(body.status).toBe("degraded");
  });

  it("returns the JSON error envelope for unknown routes", async () => {
    const res = await fetch(`${baseUrl}/v1/nope`);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { status: 404 } });
  });
});
