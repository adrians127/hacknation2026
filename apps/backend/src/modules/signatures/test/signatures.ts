import type {
  CreateSignatureBody,
  SignatureDefinition,
} from "@subsurf/contracts/signatures/signatures.schema";

import { prisma } from "~backend/lib/prisma";
import { BUILT_IN_SIGNATURES } from "~backend/modules/signatures/builtin-signatures";
import { compileSignature } from "~backend/modules/signatures/signature-engine";

/** The built-ins compiled without a database, with their key as id (pure tests). */
export const COMPILED_BUILT_INS = BUILT_IN_SIGNATURES.map((builtIn) =>
  compileSignature(
    {
      id: builtIn.key,
      key: builtIn.key,
      name: builtIn.name,
      category: builtIn.category,
      product: builtIn.product,
      severity: builtIn.severity,
      confidence: builtIn.confidence,
    },
    builtIn.definition,
  ),
);

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
