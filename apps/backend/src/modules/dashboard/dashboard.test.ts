import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DashboardResponseSchema } from "@subsurf/contracts/dashboard/dashboard.schema";

import { signInAs } from "~backend/test/auth";
import { startTestServer, TestClient, type TestServer } from "~backend/test/http";
import { ingestScan } from "~backend/test/scans";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

describe("GET /dashboard", () => {
  it("is empty before the first scan with results", async () => {
    const { client } = await signInAs(server, { role: "viewer" });

    const res = await client.get("/v1/dashboard");

    expect(res.status).toBe(200);
    expect(DashboardResponseSchema.parse(await res.json())).toMatchObject({
      scan: null,
      topChanges: [],
    });
  });

  it("compares the newest scan with the one before, most important changes first", async () => {
    const first = await ingestScan();
    // 10.0.5.8 answers this time, with SSH and an exposed MySQL.
    const second = await ingestScan((hosts) => {
      const [wiki, , ...rest] = hosts;
      const [ssh] = wiki.ports;
      return [wiki, { ...wiki, ip: "10.0.5.8", hostnames: [], ports: [ssh, { ...ssh, port: 3306, service: null }] }, ...rest];
    });
    const { client } = await signInAs(server, { role: "viewer" });

    const res = await client.get("/v1/dashboard");
    const dashboard = DashboardResponseSchema.parse(await res.json());

    expect(dashboard).toMatchObject({
      scan: { id: second },
      baseScan: { id: first },
      hosts: { up: 2, unstable: 0, inactive: 0 },
      openPorts: 4,
      changes: { hosts: { new: 1, gone: 0, changed: 0, unknown: 0 } },
      priorities: { high: 1, medium: 0, low: 0 },
    });
    expect(dashboard.topChanges).toEqual([
      expect.objectContaining({
        ip: "10.0.5.8",
        port: null,
        change: "new",
        priority: "high",
        reasons: ["new-host", "risky-port", "new-service"],
        ports: [22, 3306],
      }),
    ]);
  });

  it("needs a session", async () => {
    expect((await new TestClient(server.baseUrl).get("/v1/dashboard")).status).toBe(401);
  });
});
