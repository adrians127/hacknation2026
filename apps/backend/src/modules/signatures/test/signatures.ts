import type {
  CreateSignatureBody,
  SignatureDefinition,
} from "@subsurf/contracts/signatures/signatures.schema";

import { prisma } from "~backend/lib/prisma";

/** Matches the example result's wiki page (`x-powered-by: PHP/8.1.2`). */
export const POWERED_BY_PHP: SignatureDefinition = {
  match: "all",
  conditions: [
    {
      target: "header",
      name: { op: "equals", value: "x-powered-by" },
      value: { op: "prefix", value: "php" },
      version: String.raw`PHP/([\d.]+)`,
    },
  ],
};

export function signatureBody(overrides: Partial<CreateSignatureBody> = {}): CreateSignatureBody {
  return {
    name: "PHP in X-Powered-By",
    category: "interesting-header",
    severity: "low",
    confidence: "medium",
    definition: POWERED_BY_PHP,
    ...overrides,
  };
}

/** A custom signature row, without evaluating anything. */
export function createSignatureRow(overrides: Partial<CreateSignatureBody> = {}) {
  const { description: _description, ...body } = signatureBody(overrides);
  return prisma.signature.create({ data: { ...body, severity: body.severity ?? null } });
}
