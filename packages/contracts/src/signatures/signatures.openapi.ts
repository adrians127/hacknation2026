import { registry } from "../../scripts/registry";
import {
  cookieAuth,
  errorResponse,
  forbidden,
  notFound,
  unauthenticated,
  validationFailed,
} from "../common/common.openapi";
import { IdParamsSchema } from "../common/common.schema";
import {
  CreateSignatureBodySchema,
  SignatureExportDocumentSchema,
  SignatureExportQuerySchema,
  SignatureImportQuerySchema,
  SignatureImportResponseSchema,
  SignatureListResponseSchema,
  SignaturePreviewBodySchema,
  SignaturePreviewResponseSchema,
  SignatureSchema,
  UpdateSignatureBodySchema,
} from "./signatures.schema";

const tags = ["Signatures"];
const security = cookieAuth;

const Signature = registry.register("Signature", SignatureSchema);
const SignatureExportDocument = registry.register(
  "SignatureExportDocument",
  SignatureExportDocumentSchema,
);

const EVALUATED = [
  "The newest scan with results is evaluated again before the response; older scans follow in",
  "the background (`evaluation.pendingScans` on the list).",
].join(" ");

const conflict = errorResponse(
  [
    "A built-in signature can only be switched on or off (`SIGNATURE_BUILT_IN`), the name is taken",
    "(`SIGNATURE_NAME_TAKEN`), the enabled signatures would need too many probe paths",
    "(`SIGNATURE_PROBE_LIMIT`) or there are too many signatures (`SIGNATURE_LIMIT`)",
  ].join(" "),
);

registry.registerPath({
  method: "get",
  path: "/signatures",
  operationId: "listSignatures",
  summary: "List the detection signatures",
  description: [
    "Requires `signatures:read`. Built-in and custom signatures with how many hosts and services",
    "each matched in the newest scan with results, and the probe paths the enabled ones make the",
    "scanner request.",
  ].join(" "),
  tags,
  security,
  responses: {
    200: {
      description: "The signatures",
      content: { "application/json": { schema: SignatureListResponseSchema } },
    },
    401: unauthenticated,
    403: forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/signatures",
  operationId: "createSignature",
  summary: "Create a signature",
  description: [
    "Requires `signatures:create`. Regular expressions use RE2 syntax (no lookarounds or",
    `backreferences); an invalid one is a 400 with the condition's path. ${EVALUATED}`,
  ].join(" "),
  tags,
  security,
  request: { body: { content: { "application/json": { schema: CreateSignatureBodySchema } } } },
  responses: {
    201: { description: "The signature", content: { "application/json": { schema: Signature } } },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    409: conflict,
  },
});

registry.registerPath({
  method: "get",
  path: "/signatures/{id}",
  operationId: "getSignature",
  summary: "One signature",
  description: "Requires `signatures:read`.",
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: {
    200: { description: "The signature", content: { "application/json": { schema: Signature } } },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/signatures/{id}",
  operationId: "updateSignature",
  summary: "Change, enable or disable a signature",
  description: [
    "Requires `signatures:update`. A built-in signature takes only `enabled`. Disabling removes its",
    `matches from every scan at once. ${EVALUATED}`,
  ].join(" "),
  tags,
  security,
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: UpdateSignatureBodySchema } } },
  },
  responses: {
    200: { description: "The signature", content: { "application/json": { schema: Signature } } },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: conflict,
  },
});

registry.registerPath({
  method: "delete",
  path: "/signatures/{id}",
  operationId: "deleteSignature",
  summary: "Delete a custom signature",
  description: [
    "Requires `signatures:delete`. Its matches go from every scan. Built-in signatures cannot be",
    "deleted, only switched off.",
  ].join(" "),
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: {
    204: { description: "Deleted" },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/signatures/preview",
  operationId: "previewSignature",
  summary: "What a signature would match",
  description: [
    "Requires `signatures:read`. Evaluates a definition on one scan without saving anything: how",
    "many services and hosts match, examples with evidence, and probe paths the scan did not",
    "request (they can only match after the next scan).",
  ].join(" "),
  tags,
  security,
  request: { body: { content: { "application/json": { schema: SignaturePreviewBodySchema } } } },
  responses: {
    200: {
      description: "The preview",
      content: { "application/json": { schema: SignaturePreviewResponseSchema } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/signatures/export",
  operationId: "exportSignatures",
  summary: "Export the signatures as JSON",
  description: [
    "Requires `signatures:read`. The custom signatures (and with `builtIn=true` the built-ins,",
    "by key) in the format `POST /signatures/import` reads; see docs/signature-format.md.",
  ].join(" "),
  tags,
  security,
  request: { query: SignatureExportQuerySchema },
  responses: {
    200: {
      description: "The export file",
      content: { "application/json": { schema: SignatureExportDocument } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/signatures/import",
  operationId: "importSignatures",
  summary: "Import signatures from JSON",
  description: [
    "Requires `signatures:create`. All or nothing. Custom signatures are created; one whose name is",
    "taken is skipped or, with `conflict=replace`, overwritten. An entry with a built-in's `key`",
    `only switches that built-in on or off. ${EVALUATED}`,
  ].join(" "),
  tags,
  security,
  request: {
    query: SignatureImportQuerySchema,
    body: { content: { "application/json": { schema: SignatureExportDocument } } },
  },
  responses: {
    200: {
      description: "What the import did",
      content: { "application/json": { schema: SignatureImportResponseSchema } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    409: conflict,
  },
});
