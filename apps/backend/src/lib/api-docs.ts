import openApiDocument from "@hacknation/contracts/openapi.json" with { type: "json" };

/** The committed spec from @hacknation/contracts, served by Swagger UI at /docs (dev only). */
export function buildApiDocs(): Record<string, unknown> {
  return structuredClone(openApiDocument) as Record<string, unknown>;
}
