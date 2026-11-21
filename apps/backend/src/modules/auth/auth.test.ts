import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MeResponseSchema } from "@hacknation/contracts/auth/auth.schema";

import { ACCESS_COOKIE, REFRESH_COOKIE } from "~backend/lib/auth-cookies";
import { prisma } from "~backend/lib/prisma";
import {
  LOCKOUT_MS,
  MAX_FAILED_LOGINS,
  REFRESH_REUSE_GRACE_MS,
} from "~backend/modules/auth/auth.service";
import { createUser, signIn, signInAs, TEST_PASSWORD } from "~backend/test/auth";
import { startTestServer, TestClient, type TestServer } from "~backend/test/http";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

const login = (email: string, password: string) =>
  new TestClient(server.baseUrl).post("/v1/auth/login", { body: { email, password } });

describe("POST /v1/auth/login", () => {
  it("sets both cookies and returns the user with role and permissions", async () => {
    const user = await createUser({ role: "admin" });
    const client = new TestClient(server.baseUrl);

    const res = await client.post("/v1/auth/login", {
      body: { email: user.email.toUpperCase(), password: TEST_PASSWORD },
    });

    expect(res.status).toBe(200);
    const me = MeResponseSchema.parse(await res.json());
    expect(me).toMatchObject({ id: user.id, role: { key: "admin" }, mustChangePassword: false });
    expect(me.permissions).toContain("users:read");
    expect(client.cookies.has(ACCESS_COOKIE)).toBe(true);
    expect(client.cookies.has(REFRESH_COOKIE)).toBe(true);

    const cookies = res.headers.getSetCookie().join("\n");
    expect(cookies).toMatch(/subsurf_access=[^;]+;.*HttpOnly/i);
    expect(cookies).toMatch(/subsurf_refresh=[^;]+;.*Path=\/v1\/auth/i);
  });

  it("answers identically for a wrong password and an unknown email", async () => {
    const user = await createUser();

    const wrongPassword = await login(user.email, "not-the-password");
    const unknownEmail = await login("nobody@test.local", "not-the-password");

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
  });

  it(`locks the account for 15 minutes after ${MAX_FAILED_LOGINS} failures in a row`, async () => {
    const user = await createUser();
    for (let attempt = 0; attempt < MAX_FAILED_LOGINS; attempt++) {
      expect((await login(user.email, "wrong-password")).status).toBe(401);
    }

    const locked = await login(user.email, TEST_PASSWORD);
    expect(locked.status).toBe(401);
    expect(await locked.json()).toMatchObject({ error: { code: "INVALID_CREDENTIALS" } });

    const { lockedUntil } = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(lockedUntil?.getTime()).toBeGreaterThan(Date.now() + LOCKOUT_MS - 60_000);

    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() - 1) },
    });
    expect((await login(user.email, TEST_PASSWORD)).status).toBe(200);
  });

  it("refuses deactivated users", async () => {
    const user = await createUser({ isActive: false });

    expect((await login(user.email, TEST_PASSWORD)).status).toBe(401);
  });
});

describe("GET /v1/auth/me", () => {
  it("requires a valid access token", async () => {
    const anonymous = await new TestClient(server.baseUrl).get("/v1/auth/me");
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });

    const forged = await new TestClient(server.baseUrl).get("/v1/auth/me", {
      headers: { cookie: `${ACCESS_COOKIE}=eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.` },
    });
    expect(forged.status).toBe(401);
  });

  it("stops working as soon as the user is deactivated", async () => {
    const { user, client } = await signInAs(server, { role: "viewer" });
    expect((await client.get("/v1/auth/me")).status).toBe(200);

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    expect((await client.get("/v1/auth/me")).status).toBe(401);
  });
});

describe("POST /v1/auth/refresh", () => {
  it("rotates the refresh token and keeps the session usable", async () => {
    const { client } = await signInAs(server, {});
    const before = client.cookies.get(REFRESH_COOKIE);

    const res = await client.post("/v1/auth/refresh");

    expect(res.status).toBe(204);
    expect(client.cookies.get(REFRESH_COOKIE)).not.toBe(before);
    expect((await client.get("/v1/auth/me")).status).toBe(200);
  });

  it("accepts the previous token within the grace window without rotating again", async () => {
    const { client } = await signInAs(server, {});
    const previous = client.cookies.get(REFRESH_COOKIE);
    await client.post("/v1/auth/refresh");
    const current = client.cookies.get(REFRESH_COOKIE);

    const parallel = await new TestClient(server.baseUrl).post("/v1/auth/refresh", {
      headers: { cookie: `${REFRESH_COOKIE}=${previous}` },
    });

    expect(parallel.status).toBe(204);
    expect(parallel.headers.getSetCookie().join("\n")).not.toContain(REFRESH_COOKIE);
    expect((await client.post("/v1/auth/refresh")).status).toBe(204);
    expect(client.cookies.get(REFRESH_COOKIE)).not.toBe(current);
  });

  it("revokes the whole session when an old refresh token comes back later", async () => {
    const { client } = await signInAs(server, {});
    const stolen = client.cookies.get(REFRESH_COOKIE);
    await client.post("/v1/auth/refresh");
    await prisma.session.updateMany({
      data: { rotatedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1_000) },
    });

    const replay = await new TestClient(server.baseUrl).post("/v1/auth/refresh", {
      headers: { cookie: `${REFRESH_COOKIE}=${stolen}` },
    });

    expect(replay.status).toBe(401);
    expect((await client.post("/v1/auth/refresh")).status).toBe(401);
    expect((await client.get("/v1/auth/me")).status).toBe(401);
  });

  it("rejects a missing or malformed refresh token", async () => {
    const anonymous = new TestClient(server.baseUrl);

    expect((await anonymous.post("/v1/auth/refresh")).status).toBe(401);
    const malformed = await anonymous.post("/v1/auth/refresh", {
      headers: { cookie: `${REFRESH_COOKIE}=garbage` },
    });
    expect(malformed.status).toBe(401);
  });
});

describe("POST /v1/auth/logout", () => {
  it("revokes the session and clears both cookies", async () => {
    const { client } = await signInAs(server, {});
    const accessToken = client.cookies.get(ACCESS_COOKIE);

    const res = await client.post("/v1/auth/logout");

    expect(res.status).toBe(204);
    expect(client.cookies.size).toBe(0);
    const reused = await new TestClient(server.baseUrl).get("/v1/auth/me", {
      headers: { cookie: `${ACCESS_COOKIE}=${accessToken}` },
    });
    expect(reused.status).toBe(401);
  });

  it("refuses a cross-site request (CSRF)", async () => {
    const { client } = await signInAs(server, {});

    const res = await client.post("/v1/auth/logout", {
      headers: { origin: "https://evil.example" },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "UNTRUSTED_ORIGIN" } });
    const fromFrontend = await client.post("/v1/auth/logout", {
      headers: { origin: "http://localhost:3000" },
    });
    expect(fromFrontend.status).toBe(204);
  });
});

describe("POST /v1/auth/change-password", () => {
  const newPassword = "a-brand-new-long-password";

  it("clears the forced change and signs out the other sessions", async () => {
    const user = await createUser({ mustChangePassword: true });
    const client = await signIn(server, user.email);
    const otherDevice = await signIn(server, user.email);
    const me = MeResponseSchema.parse(await (await client.get("/v1/auth/me")).json());
    expect(me.mustChangePassword).toBe(true);

    const res = await client.post("/v1/auth/change-password", {
      body: { currentPassword: TEST_PASSWORD, newPassword },
    });

    expect(res.status).toBe(204);
    const after = MeResponseSchema.parse(await (await client.get("/v1/auth/me")).json());
    expect(after.mustChangePassword).toBe(false);
    expect((await otherDevice.get("/v1/auth/me")).status).toBe(401);
    expect((await login(user.email, newPassword)).status).toBe(200);
  });

  it("checks the current password with a 403, so clients do not try to refresh", async () => {
    const { client } = await signInAs(server, {});

    const res = await client.post("/v1/auth/change-password", {
      body: { currentPassword: "wrong-password", newPassword },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_CREDENTIALS" } });
  });

  it("enforces the password policy", async () => {
    const { client } = await signInAs(server, {});

    const tooShort = await client.post("/v1/auth/change-password", {
      body: { currentPassword: TEST_PASSWORD, newPassword: "short" },
    });
    const unchanged = await client.post("/v1/auth/change-password", {
      body: { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD },
    });

    expect(tooShort.status).toBe(400);
    expect(unchanged.status).toBe(400);
  });
});
