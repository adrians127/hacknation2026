import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockError, mockResponse } from "@/api/mock";

describe("api mocks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mockResponse resolves with a copy of the fixture", async () => {
    const fixture = { items: [{ id: "1" }] };
    const pending = mockResponse(fixture);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result).toEqual(fixture);
    expect(result).not.toBe(fixture);
    expect(result.items).not.toBe(fixture.items);
  });

  it("mockError rejects with the ErrorResponse body", async () => {
    const pending = mockError(404, "Target not found").catch((error: unknown) => error);
    await vi.runAllTimersAsync();

    expect(await pending).toEqual({ error: { status: 404, message: "Target not found" } });
  });

  it("mockError adds the error code when given", async () => {
    const pending = mockError(409, "Email already taken", "EMAIL_TAKEN").catch(
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();

    expect(await pending).toEqual({
      error: { status: 409, message: "Email already taken", code: "EMAIL_TAKEN" },
    });
  });
});
