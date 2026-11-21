import type { ErrorResponse } from "@hacknation/contracts/common/common.schema";

const DEFAULT_LATENCY_MS = 300;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Stand-in for a backend response while an endpoint is mocked (see README, "Mocking endpoints"). */
export async function mockResponse<T>(data: T, latencyMs = DEFAULT_LATENCY_MS): Promise<T> {
  await delay(latencyMs);
  // A copy, so the query cache never shares references with the in-memory fixtures.
  return structuredClone(data);
}

/** Rejects with the same `ErrorResponse` body that openapi-react-query throws for a non-2xx response. */
export async function mockError(status: number, message: string, latencyMs = DEFAULT_LATENCY_MS): Promise<never> {
  await delay(latencyMs);
  const body: ErrorResponse = { error: { status, message } };
  throw body;
}
