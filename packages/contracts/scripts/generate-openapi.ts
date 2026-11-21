import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";

import { importRegistries } from "./import-registries";
import { registry } from "./registry";

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = join(here, "../openapi.json");

async function main(): Promise<void> {
  await importRegistries();

  registry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "asi_access",
    description: "Access JWT set by `POST /auth/login`, refreshed through `POST /auth/refresh`.",
  });
  registry.registerComponent("securitySchemes", "workerToken", {
    type: "http",
    scheme: "bearer",
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  const document = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Attack Surface Intelligence API",
      version: "0.0.0",
      description: "Generated from @hacknation/contracts zod schemas. Do not edit by hand.",
    },
    servers: [{ url: "http://localhost:3001/v1", description: "Local development" }],
    tags: [
      { name: "Auth", description: "Sign-in, session and the current user" },
      { name: "Health", description: "Service health checks" },
      { name: "Roles", description: "System and custom roles (RBAC)" },
      { name: "Targets", description: "IP addresses, CIDR ranges and domains to scan" },
      { name: "Users", description: "User accounts, managed by administrators" },
      { name: "Workers", description: "Scanning worker lease and result protocol" },
    ],
  });

  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`OpenAPI spec written to ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error("Failed to generate OpenAPI spec:", error);
  process.exit(1);
});
